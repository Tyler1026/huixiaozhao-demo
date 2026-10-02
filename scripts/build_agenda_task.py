"""Prepare (do not submit) a valid one-shot Agenda research task.

The scheduler forwards this complete object to the agenda tool. A deterministic
future runAt replaces the obsolete unscheduled create-then-run template.
"""
import argparse
import datetime as dt
import json
import pathlib
import re


def validate(task, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if not isinstance(task, dict) or not isinstance(task.get('taskConfig'), dict):
        raise ValueError('taskConfig must be an object')
    if not task.get('runAt') or task.get('cron'):
        raise ValueError('one-shot task requires runAt and no cron')
    try:
        when = dt.datetime.fromisoformat(task['runAt'].replace('Z', '+00:00'))
    except (ValueError, TypeError, AttributeError):
        raise ValueError('invalid runAt') from None
    if when.tzinfo is None or when <= now:
        raise ValueError('runAt must be a future timezone-aware timestamp')
    return task


def build(config_path, request_id, agent_id, *, now=None, delay=90):
    config_path = pathlib.Path(config_path)
    if not config_path.is_absolute():
        raise ValueError('config path must be absolute')
    if not re.fullmatch(r'rr[A-Za-z0-9_-]{1,64}', request_id):
        raise ValueError('invalid request id')
    if not isinstance(delay, int) or not 30 <= delay <= 600:
        raise ValueError('delay must be 30..600 seconds')
    config = json.loads(config_path.read_text())
    matches = [a for w in config['waves'].values() for a in w.get('agents', []) if a.get('id') == agent_id]
    if len(matches) != 1:
        raise ValueError('agent must appear exactly once in config')
    agent = matches[0]
    if not agent.get('prompt') or not agent.get('gate_cmd'):
        raise ValueError('agent prompt and gate_cmd required')
    now = now or dt.datetime.now(dt.timezone.utc)
    if now.tzinfo is None:
        raise ValueError('now must be timezone-aware')
    run_at = (now + dt.timedelta(seconds=delay)).astimezone(dt.timezone.utc).isoformat().replace('+00:00', 'Z')
    prompt = (
        f'你只执行报告申请 {request_id} 的研究阶段 {agent_id}。不要创建或调度其他任务。\n'
        f'用read_file读取配置 {config_path}，从waves各组agents中找id严格等于 {agent_id} 的对象，'
        '完整执行其prompt，最终执行其gate_cmd。不要把旧文件存在当作本轮成功。\n'
        '开始时记录当前输出文件的修改时间与哈希；真正完成本轮研究并写入后重新检查，'
        '已有文件先read_file再修改。不得删除其他阶段成果。\n'
        '搜索地域按真实行政区使用上海市闵行区等名称，不把模板中的“省/市”后缀机械拼接。'
        '不得捏造来源、数字或企业，资料不足要明确记录。\n'
        '如已有本轮有效部分成果，读取并从未完成部分继续，不机械从头生成。'
        '单次运行到期不等于报告被放弃，记录具体中断和下一步，由接续器继续；不得标记skipped。\n'
        '本阶段全部门禁通过后，在 /Users/ryan/outputs/agenda/' + request_id + '/' + agent_id + '.json '
        '写入完成凭证：request_id、agent_id、status=completed、finishedAt、所有输出绝对路径与SHA256、gate结果。'
        '门禁未通过不得写completed；action_planner还必须检查00_executive_summary.md至少80行。'
    )
    task = {'action': 'create', 'name': f'慧小招-{request_id}-{agent_id}',
            'runAt': run_at, 'taskType': 'generative', 'enabled': True,
            'taskConfig': {'capability': 'network-allowed', 'requestTimeoutMs': 600000,
                           'noProgressTimeoutMs': 120000, 'prompt': prompt}}
    return validate(task, now)


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config', required=True)
    p.add_argument('--request-id', required=True)
    p.add_argument('--agent', required=True)
    p.add_argument('--delay', type=int, default=90)
    args = p.parse_args()
    print(json.dumps(build(args.config, args.request_id, args.agent, delay=args.delay), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
