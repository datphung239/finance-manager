import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as implemented from '../src/validators.js';

const originalSource = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const start = originalSource.indexOf('function isInitialDataShape(data)');
const end = originalSource.indexOf('function fetchInitialDataOnly', start);
assert.ok(start >= 0 && end > start, 'validators must remain in original source');
const original = vm.runInNewContext(
  originalSource.slice(start, end) + '\n({isInitialDataShape, isCardViewShape, isCashDashboardShape, isBootstrapShape, isTransactionListShape})'
);

const initial = {cards:[], categories:[], merchants:[],cashCategories:[],
  cashCPCategories:[], cashMerchants:[]};
const cardView = {dashboard:{kpi:{},statements:[],filters:{}},categoryReport:[]};
const cashDashboard = {period:{},paymentData:{},monthTrends:[],ratioTableData:{},
  frequencyData:{},dailyData:{},targetData:{},
  businessData:{result:[],revenueExpense:[]}};
const baseline = [undefined,null,false,true,0,1,'','text',{},[],[1,null],
  {cards:[]}, initial, {...initial,cashMerchants:undefined},
  cardView,{...cardView,categoryReport:null},
  cashDashboard,{...cashDashboard,monthTrends:{}},
  {initialData:initial,cardView},
  {initialData:initial,cardView,cashDashboard},
  {initialData:initial,cardView,cashDashboard:null},
  [{},null], [{},{}]];
for (const name of ["isInitialDataShape","isCardViewShape","isCashDashboardShape","isBootstrapShape","isTransactionListShape"]) {
  test(name + ' preserves original truthiness and nested schema checks', () => {
    for (const [index, data] of baseline.entries()) {
      assert.equal(implemented[name](data), original[name](data),
        name + ' case ' + index + ': ' + JSON.stringify(data));
    }
  });
}
