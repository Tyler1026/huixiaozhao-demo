import hashlib
import unittest
from backend.report_analysis import analytical_priority,review_priorities
from backend.industry_demands import create_industry_demand
from test_industry_demands import state,request,PRINCIPAL
from backend.direction_suggestions import build_direction_suggestions


class ProjectFollowupTests(unittest.TestCase):
    def test_focused_generation_reviews_source_bound_directions_for_each_city(self):
        for city in ('随州市','武汉市','成都市'):
            row,catalog=self.proposal(city)
            research={'status':'ready','evidence':[dict(catalog['source1'],status='source')],'sources':{}}
            calls=[]
            def model(system,user,tokens):
                calls.append(user)
                return {'priorities':[row]} if len(calls)==1 else {'verdicts':[{'index':0,'valid':True,'reason':'本地项目来源与行动边界匹配'}]}
            result=build_direction_suggestions({'city':city,'topic':'生物医药'},research,model)
            self.assertEqual(len(result['plan']['analytical_priorities']),1)
            self.assertEqual(len(calls),2)

    def proposal(self,city):
        quote=city+'正在推进生物医药中试平台建设，具体服务需求需开展企业访谈核实。'
        catalog={'source1':{'id':'source1','quote':quote,'url':'https://www.gov.cn/project',
                            'title':'项目公开报道','source_type':'government'}}
        row={'focus':'生物医药中试平台','opportunity_type':'project_followup','scope':'project',
             'evidence_ids':['source1'],'comparison':'公开报道披露平台建设，实际运营与合作条件仍需核实。',
             'reason':'可围绕该平台开展中试服务需求访谈，先确认实施阶段和服务对象。',
             'action':'对接平台建设责任主体，访谈企业核实中试任务、服务条件与合作方式。'}
        return row,catalog

    def test_multiple_cities_reviewed_direction_can_become_separate_demand(self):
        for city in ('随州市','武汉市','成都市'):
            row,catalog=self.proposal(city)
            candidate=analytical_priority(row,catalog,{'city':city},[])
            self.assertIsNotNone(candidate)
            reviewed,_=review_priorities([candidate],catalog,{'city':city},
                lambda *args:{'verdicts':[{'index':0,'valid':True,'reason':'原文项目及建议边界匹配'}]})
            self.assertEqual(len(reviewed),1)
            data=state();data['PROJECTS']['p']['city']=city
            meta=data['REPORTSTATE']['p']['researchByTopic']['生物医药']
            meta['analysis']['priorities']=reviewed;meta['sources']=list(catalog.values())
            result=create_industry_demand(request(data),data,PRINCIPAL,now=1000)
            self.assertEqual(result['project']['workspaceId'],'p')
            self.assertEqual(result['project']['selectedPriority']['opportunity_type'],'project_followup')

    def test_other_city_invented_focus_or_promised_order_is_rejected(self):
        row,catalog=self.proposal('武汉市')
        self.assertIsNone(analytical_priority(row,catalog,{'city':'随州市'},[]))
        row,catalog=self.proposal('随州市');row['focus']='原文不存在的平台'
        self.assertIsNone(analytical_priority(row,catalog,{'city':'随州市'},[]))
        row,catalog=self.proposal('随州市');row['reason']='该项目保证产生新采购订单和投资。'
        self.assertIsNone(analytical_priority(row,catalog,{'city':'随州市'},[]))
