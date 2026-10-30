"""Stream progress while researching companies; commit only current inputs."""
import hashlib
import json
import threading
import time
import uuid
from .auth import AuthError, require_session
from .auth_routes import error_response
from .evidence_grounding import project_context
from .funnel_research import build_funnel


def input_fingerprint(context, state):
    keys = (context['projectKey'], context['workspaceId'])
    deliveries = [{field: (state.get('PROJECTS',{}).get(key) or {}).get(field)
                   for field in ('baseReportVersion','reportFiles')} for key in keys]
    value = [context, deliveries]
    return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()


def serve_funnel(handler, body, *, complete, audit, build=build_funnel, package_loader=None,
                 heartbeat_seconds=12):
    from .access_control import scoped_sync_view
    try:
        context=project_context(body,handler._scoped_state)
        if body.get('reportRequestId') and body['reportRequestId']!=context['reportRequestId']:
            raise AuthError(409,'report_changed','需求版本已更新，请刷新后重新分析')
        fingerprint=input_fingerprint(context,handler._scoped_state)
    except AuthError as error:
        return error_response(handler,error)
    stream=body.get('stream',True)
    lock=threading.Lock();stop=threading.Event()
    run_id=uuid.uuid4().hex
    handler.send_response(200)
    handler.send_header('Content-Type','text/event-stream; charset=utf-8' if stream else 'application/json; charset=utf-8')
    handler.send_header('Cache-Control','no-store, no-transform')
    handler.send_header('X-Accel-Buffering','no')
    handler.cors();handler.end_headers()
    def send(value):
        if not stream:
            return
        with lock:
            handler.wfile.write(('data: '+(value if isinstance(value,str) else json.dumps(value,ensure_ascii=False))+'\n\n').encode())
            handler.wfile.flush()
    started=time.monotonic()
    latest={'stage':'materials','message':'已收到分析请求，正在核对当前城市资料与需求'}
    def progress(value):
        details=dict(value) if isinstance(value,dict) else {'message':value}
        with lock:
            latest.update(details)
            status=dict(latest)
        send(dict(status,type='funnel_progress',runId=run_id,elapsedSeconds=int(time.monotonic()-started)))
    def heartbeat():
        while not stop.wait(heartbeat_seconds):
            try:
                with lock:
                    status=dict(latest)
                send(dict(status,type='funnel_progress',runId=run_id,heartbeat=True,
                          elapsedSeconds=int(time.monotonic()-started)))
            except OSError:
                stop.set();return
    if stream:
        threading.Thread(target=heartbeat,daemon=True,name='company-research-heartbeat').start()
    try:
        progress(latest)
        package=None
        if package_loader:
            try:
                # Submitted demands freeze their own report and often have no
                # reportRequestId. Resolve the authorized parent city's current
                # delivery explicitly; never use a same-city global workspace.
                root=(handler._scoped_state.get('PROJECTS') or {}).get(context['workspaceId']) or {}
                package_context=context
                if context['workspaceId']!=context['projectKey'] and root.get('reportRequestId'):
                    if root.get('city','').removesuffix('市')!=context['city'].removesuffix('市'):
                        raise AuthError(409,'city_package_mismatch','城市资料与当前需求不一致，请联系管理员核对')
                    package_context=dict(context,projectKey=context['workspaceId'],
                        reportRequestId=root['reportRequestId'],_researchMode='full')
                package=package_loader(package_context,handler._scoped_state)
            except Exception as error:
                # Direct requests may predate a published city delivery. Invalid
                # or wrong-city archives must not be silently accepted.
                if getattr(error,'code','') not in ('city_package_missing','city_topic_evidence_missing'):
                    raise
        result=build(context,complete,package=package,
            progress=progress)
        progress({'stage':'saving','message':'企业匹配分析完成，正在校验版本并保存排名'})
        with handler._account_session() as session:
            state=json.loads(session.read())
            principal=require_session(handler.headers,state,admin_config=handler._account_config())
            scoped=scoped_sync_view(state,principal)
            current=project_context(body,scoped)
            if input_fingerprint(current,scoped)!=fingerprint:
                raise AuthError(409,'evidence_changed','需求或材料已更新，原候选保留，请重新分析')
            project=state['PROJECTS'][current['projectKey']]
            if project.get('topic')!=current['topic']:
                raise AuthError(409,'topic_changed','方向已切换，请重新分析')
            # A partial run cannot erase a larger current, reviewed source pool.
            from .funnel_research import verified_catalog
            previous=project.get('funnel') or {}
            if result.get('status')=='partial' and len(previous.get('companies',[]))>len(result['companies']) and verified_catalog(previous,current):
                raise AuthError(503,'company_analysis_incomplete','本轮分析未完成，已保留上次较完整清单，请重试')
            result.update(ts=int(time.time()*1000),total=len(result['companies']),pushed=False)
            project['funnel']=result
            if not session.write(json.dumps(state,ensure_ascii=False)):
                raise AuthError(503,'storage_unavailable','结果尚未保存，原候选保留，请重试')
        response={'choices':[{'delta' if stream else 'message':{'content':json.dumps(result,ensure_ascii=False)},'finish_reason':'stop'}],'runId':run_id}
        if stream:
            send(response);send('[DONE]')
        else:
            handler.wfile.write(json.dumps(response,ensure_ascii=False).encode())
        audit({'runId':run_id,'purpose':'funnel','projectKey':context['projectKey'],
               'outcome':'completed','companies':len(result['companies']),'status':result.get('status'),
               'elapsed_ms':round((time.monotonic()-started)*1000)})
    except Exception as error:
        code=getattr(error,'code','company_research_incomplete')
        message=(str(error) if isinstance(error,AuthError) else
                 '企业检索或分析未完成，原候选清单已保留，请稍后重试；系统不会将服务失败当作没有相关企业。')
        response={'error':{'code':code,'message':message},'choices':[{'delta':{},'finish_reason':'error'}],'runId':run_id}
        if stream:
            send(response);send('[DONE]')
        else:
            handler.wfile.write(json.dumps(response,ensure_ascii=False).encode())
        audit({'runId':run_id,'purpose':'funnel','projectKey':context['projectKey'],
               'outcome':'failed','code':code,'error_type':type(error).__name__})
    finally:
        stop.set()
