const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { createRequire } = require('node:module');
const dependency = createRequire(process.env.CLARISA_TEST_DEPENDENCIES || __filename);
const { chromium } = dependency('playwright-core');
const root = path.resolve(__dirname, '..');
const fixtures = (christmas) => {
  const groups = ['a','b'].map((id,i)=>({id,job_id:'job',group_name:`6to ${id.toUpperCase()}`,teacher_name:`Maestra ${id}`,teacher_phone:'6671234567',selected_package_id:'pkg',package_quantity:10,price:2000,sort_order:i,packages:{name:'Paquete escolar',price:200}}));
  return {jobs:[{id:'job',title:'PEMEX - Graduacion',client_id:'client',job_type:'SCHOOL_GRADUATION',event_type:christmas?'CHRISTMAS':'GRADUATION',price:4000,status:'EDITING',approval_token:'example',clients:{name:'PEMEX',phone:'6671234567',school_profiles:[{school_level:'PRIMARY',school_name:'PEMEX'}]}}],school_groups:groups,
    packages:[{id:'pkg',name:'Paquete escolar',price:200,school_level:'PRIMARY',is_active:true,package_type:christmas?'SCHOOL_CHRISTMAS':'SCHOOL_GRADUATION'}],
    print_items:christmas?[]:groups.flatMap(g=>['PHOTO_PACKAGE','DIPLOMA','FOLDER_OPTION','GROUP_PHOTO','STUDENT_GALLERY'].map((type,i)=>({id:g.id+i,group_id:g.id,job_id:'job',item_type:type,title:type,status:type==='DIPLOMA'?'CHANGES_REQUESTED':type==='FOLDER_OPTION'?'APPROVED_FOR_PRINT':'PENDING',client_notes:type==='DIPLOMA'?'Corregir apellido de directora':null,selected_file_id:i<3?'catalog':null,selected_package_id:i===0?'pkg':null,approval_token:'token-'+g.id+i}))),
    galleries:[{id:'gal',job_id:'job',group_id:'b',title:'Galeria B',is_active:true,gallery_type:'STUDENT_GALLERY',google_photos_url:'https://photos.app.goo.gl/example'}],
    deposits:[{id:'dep',job_id:'job',group_id:'a',amount:500,deposit_date:'2026-09-14'}],
    job_files:christmas?[]:[{id:'file',job_id:'job',print_item_id:'a1',file_type:'TEACHER_PREVIEW',file_name:'Diploma corregido.jpg',content_type:'image/png',size_bytes:25000,created_at:'2026-09-14'}],
    file_share_links:[],work_assignments:[],staff_roles:[],message_logs:[],job_activity:[]};
};
const server=createServer(async(req,res)=>{try { const file=path.join(root,new URL(req.url,'http://localhost').pathname); res.setHeader('content-type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':'text/html');res.end(await readFile(file)); } catch {res.statusCode=404;res.end();}});
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try {
  browser=await chromium.launch({headless:true,...(process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH}:{})});
  for(const christmas of [false,true]) {
   const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/js/auth.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function requireAuth(){return {id:"owner"}};export function isOwner(){return true}'}));
   await page.route('**/js/supabase.js',r=>r.fulfill({contentType:'text/javascript',body:`
     window.__db=${JSON.stringify(fixtures(christmas))};window.__writes=[];
     export const supabase={from(table){let filters=[],single=false,mode=null,payload;const q={select(){return q},order(){return q},limit(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},in(k,v){filters.push(x=>v.includes(x[k]));return q},single(){single=true;return q},insert(p){mode='insert';payload=p;return q},update(p){mode='update';payload=p;return q},delete(){mode='delete';return q},then(resolve){const all=window.__db[table]||[];let rows=all.filter(x=>filters.every(f=>f(x)));if(mode){window.__writes.push({table,mode,payload});if(mode==='insert'){rows=(Array.isArray(payload)?payload:[payload]).map(p=>({id:'new',...p}));all.push(...rows)}if(mode==='update')rows.forEach(x=>Object.assign(x,payload));if(mode==='delete')window.__db[table]=all.filter(x=>!rows.includes(x))}return Promise.resolve({data:single?rows[0]:rows,error:null}).then(resolve)}};return q}};
   `}));
   await page.route('**/js/catalog.js',r=>r.fulfill({contentType:'text/javascript',body:'export async function getCatalogFileUrl(){return window.__image}'}));
   const r2=await readFile(path.join(root,'js/r2-files.js'),'utf8');
   const modified=r2.slice(0,r2.indexOf('export async function uploadR2File'))+`
     export async function uploadR2File(job,type,file,item){window.__upload={job,type,item,name:file.name}}
     export async function deleteR2File(id){window.__deletedFile=id}
     export async function getAdminFileUrl(){return window.__image}
   `;
   await page.route('**/js/r2-files.js',r=>r.fulfill({contentType:'text/javascript',body:modified}));
   await page.addInitScript(()=>{const c=document.createElement('canvas');c.width=600;c.height=400;const x=c.getContext('2d');x.fillStyle='#eee9dc';x.fillRect(0,0,600,400);x.fillStyle='#295b60';x.font='38px serif';x.fillText('Diploma',200,180);window.__image=c.toDataURL();});
   await page.goto(`http://127.0.0.1:${server.address().port}/job-detail.html?id=job`);
   await page.locator('.workflow-group').first().waitFor();
   assert.equal(await page.locator('.workflow-group').count(),2);
   assert.equal(await page.locator('#generalTools').evaluate(x=>x.open),false);
   assert.equal(await page.locator('#jobActivity').evaluate(x=>x.open),false);
   assert.equal(await page.locator('.workflow-group').first().evaluate(x=>x.open),true);
   assert.equal(await page.locator('.workflow-group').nth(1).evaluate(x=>x.open),false);
   assert.match(await page.locator('.workflow-group-finance').first().innerText(),/1,500/);
   await page.locator('[data-group-deposit="a"]').click();
   assert.equal(await page.locator('#detailForm [name="group_id"]').inputValue(),'a');
   await page.locator('[name="amount"]').fill('200');
   await page.getByRole('button',{name:'Guardar abono',exact:true}).click();
   await page.waitForFunction(()=>document.querySelector('.workflow-group-finance').innerText.includes('1,300'));
   assert.equal(await page.locator('#detailModal').isVisible(),false);
   await page.locator('[data-disclosure="group-b"]>summary').click();
   if(christmas){
    assert.equal(await page.locator('[data-item-dropzone]').count(),0);
    assert.equal(await page.locator('.workflow-piece').count(),2);
    await page.locator('[data-disclosure="gallery-b"]>summary').click();
    assert.equal(await page.locator('[data-disclosure="gallery-b"] a').count(),1);
    await page.locator('[data-group-gallery="b"]').click();
    assert.equal(await page.locator('#detailForm [name="group_id"]').inputValue(),'b');
    await page.locator('[data-close-modal]').click();
   }else{
    assert.equal(await page.locator('.workflow-piece').count(),10);
    await page.locator('[data-disclosure="piece-a1"]>summary').click();
    assert.match(await page.locator('[data-disclosure="piece-a1"]').innerText(),/Corregir apellido/);
    const choosing = page.waitForEvent('filechooser');
    await page.locator('[data-item-dropzone="a1"][data-file-type="TEACHER_PREVIEW"]').click();
    await (await choosing).setFiles({name:'correccion.png',mimeType:'image/png',buffer:Buffer.from('test')});
    await page.waitForFunction(()=>window.__upload?.item==='a1' && document.querySelector('[data-disclosure="piece-a1"]').open);
    assert.equal(await page.locator('[data-disclosure="group-b"]').evaluate(x=>x.open),true);
    assert.equal(await page.locator('[data-disclosure="piece-a1"] img').count(),1);
    await page.waitForFunction(()=>{const image=document.querySelector('[data-disclosure="piece-a1"] img');return image?.complete && image.naturalWidth>0});
    await page.locator('[data-edit-group="a"]').first().click();
    assert.equal(await page.locator('[name="selected_package_id"]').inputValue(),'pkg');
    await page.locator('[data-close-modal]').click();
   }
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Page overflow');
    await page.screenshot({path:`/tmp/clarisa-workflow-${christmas?'christmas':'graduation'}-${width}.png`,fullPage:true});
   }
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('OK: graduation/Christmas groups, balances, deposit assignment, modal close, gallery assignment, piece uploads, disclosure persistence and desktop/mobile layout.');
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1});
