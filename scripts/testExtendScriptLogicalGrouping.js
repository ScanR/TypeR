const assert=require('assert'),vm=require('vm'),group=require('./extendScriptLogicalGrouping');
const expressions=['true || false && false','false && true || true','a || b && c || d','a && (b || c) && d','a || (b && (c || d))'];
const values=[false,true];
for(const source of expressions){
 const grouped=group('('+source+');');
 for(const a of values)for(const b of values)for(const c of values)for(const d of values){
  assert.equal(vm.runInNewContext(grouped,{a,b,c,d}),vm.runInNewContext(source,{a,b,c,d}));
 }
}
assert(group('true || false && false;').includes('(false && false)'));
console.log('ExtendScript logical grouping: mixed operators retain JS behavior after minification');
