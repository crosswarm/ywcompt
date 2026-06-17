/** 审批消息中心生成逻辑测试 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const writeJson = (dir, name, data) => {
  fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(data), 'utf-8');
};

describe('审批消息中心智能生成', () => {
  const previousDataDir = process.env.DATA_DIR;

  afterEach(() => {
    if (previousDataDir === undefined) {
      delete process.env.DATA_DIR;
    } else {
      process.env.DATA_DIR = previousDataDir;
    }
    delete require.cache[require.resolve('../ai-workbench-node/src/routes/shared')];
  });

  test('审批消息中心意图只生成独立审批消息中心组件', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'approval-message-center-generation-'));
    process.env.DATA_DIR = dataDir;
    writeJson(dataDir, 'template', [
      {
        id: 'tpl-test',
        name: '测试模板',
        initPrompt: '生成测试驾驶舱',
        needRefresh: true,
        description: '测试模板说明',
        keywords: ['测试'],
        widgets: [
          {
            id: 'metric-template',
            type: 'metric',
            title: '模板指标',
            position: { x: 0, y: 0, w: 3, h: 2 },
            data: { metrics: [{ label: '指标', value: 1 }] }
          }
        ]
      }
    ]);
    writeJson(dataDir, 'widget-catalog', [
      {
        id: 'builtin-business-approval-message-center',
        name: '审批消息中心',
        type: 'business',
        category: '业务组件',
        icon: 'Bell',
        color: '#dc2626',
        description: '审批助手消息中心',
        agentDescription: '审批助手 yonbip-ec-todocenter 审批消息中心 待办审批',
        useCases: ['审批助手', '待办审批'],
        tags: ['审批助手', 'yonbip-ec-todocenter'],
        template: {
          type: 'business',
          title: '审批消息中心',
          position: { x: 0, y: 0, w: 8, h: 6 },
          business: {
            category: 'business',
            businessType: 'approval-message-center',
            dataContract: 'message-center:list',
            actionContract: 'message-center:process',
            documentDetailContract: 'message-center:document-detail'
          },
          dataSource: {
            type: 'skill',
            skillId: 'yonbip-ec-todocenter'
          },
          data: {
            businessType: 'approval-message-center'
          }
        },
        enabled: true
      },
      {
        id: 'builtin-metric',
        name: '指标卡',
        type: 'metric',
        category: '指标',
        icon: 'Target',
        color: '#2563eb',
        description: '指标组件',
        agentDescription: '待办 总览 指标',
        useCases: ['待办总览'],
        tags: ['待办'],
        template: {
          type: 'metric',
          title: '待办总览',
          data: { metrics: [{ label: '待办', value: 1 }] }
        },
        enabled: true
      }
    ]);
    writeJson(dataDir, 'cockpit', []);

    const { createCockpitFromTemplate } = require('../ai-workbench-node/src/routes/shared');
    const cockpit = createCockpitFromTemplate({
      name: '审批消息中心',
      initPrompt: '审批消息中心驾驶舱，展示待审批事项和审批助手操作'
    });

    expect(cockpit.widgets).toHaveLength(1);
    expect(cockpit.widgets[0].title).toBe('审批消息中心');
    expect(cockpit.widgets[0].business.businessType).toBe('approval-message-center');
    expect(cockpit.widgets[0].position).toEqual(expect.objectContaining({ w: 8, h: 6 }));
    expect(cockpit.widgets[0].data.summary).toEqual(expect.objectContaining({
      total: 18,
      criticalCount: 3,
      attentionCount: 9,
      autoCount: 6
    }));
    expect(cockpit.widgets[0].data.criticalItems).toHaveLength(3);
    expect(cockpit.widgets[0].data.attentionItems).toHaveLength(9);
    expect(cockpit.widgets[0].data.autoItems).toHaveLength(6);
    expect(cockpit.widgets[0].data.attentionGroups.reduce((sum, group) => (
      sum + group.items.length
    ), 0)).toBe(9);
    expect(cockpit.widgets[0].data.criticalItems[0].businessRef).toEqual(expect.objectContaining({
      source: 'yonbip-ec-todocenter',
      openMode: 'drawer'
    }));
    expect(cockpit.widgets[0].data.attentionItems[0].businessRef).toEqual(expect.objectContaining({
      source: 'yonbip-ec-todocenter',
      openMode: 'drawer'
    }));
    expect(cockpit.widgets[0].data.autoItems[0].businessRef).toEqual(expect.objectContaining({
      source: 'yonbip-ec-todocenter',
      openMode: 'drawer'
    }));
  });
});
