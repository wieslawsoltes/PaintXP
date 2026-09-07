"""Standalone browser integration tests. Python Playwright is a test-only dependency.
Use PAINT_TEST_URL=http://127.0.0.1:5173 to test the HTTP module build, including WebGPU.
Without a URL, load the generated single-file app using set_content (Canvas 2D).
"""
from pathlib import Path
from playwright.sync_api import sync_playwright
import base64, io, json, os, time
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
OUTPUT=ROOT/'docs'/'screenshots'
OUTPUT.mkdir(parents=True,exist_ok=True)
results=[]
def check(name, predicate):
    assert predicate, name
    results.append(name)
    print('PASS',name)

def call(page,name,args=None):
    return page.evaluate('([name,args])=>window.paintXP.execute(name,args)',[name,args or {}])

def load(page):
    if os.environ.get('PAINT_TEST_URL'):
        page.goto(os.environ['PAINT_TEST_URL'])
    else:
        page.set_content((ROOT/'paint-xp.html').read_text(),wait_until='load')
    page.evaluate('async()=>{await window.paintXP.ready;return true;}')
    page.wait_for_timeout(100)

with sync_playwright() as p:
    browser=p.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH','/usr/bin/chromium'),headless=True,args=['--no-sandbox','--enable-unsafe-webgpu','--use-angle=swiftshader','--disable-dev-shm-usage'])
    page=browser.new_page(viewport={'width':1100,'height':790},device_scale_factor=1)
    errors=[]
    page.on('pageerror',lambda e:errors.append(str(e)))
    load(page)
    check('app ready; 16 original tools',page.locator('[data-tool]').count()==16)
    check('initial document 640×480',call(page,'paint_get_state')['width']==640)
    page.screenshot(path=str(OUTPUT/'desktop-blank.png'))
    call(page,'paint_new',{'width':400,'height':300})
    # Real pointer stroke, not only API dispatch.
    r=page.locator('#overlay').bounding_box()
    page.mouse.move(r['x']+13,r['y']+13);page.mouse.down();page.mouse.move(r['x']+103,r['y']+53,steps=15);page.mouse.up()
    check('mouse pencil commits exact first and last pixels',all(x['color']=='#000000' for x in call(page,'paint_get_pixels',{'points':[{'x':10,'y':10},{'x':100,'y':50}]})['pixels']))
    call(page,'paint_edit',{'action':'undo'})
    check('undo pointer stroke',call(page,'paint_get_pixels',{'points':[{'x':10,'y':10}]})['pixels'][0]['color']=='#ffffff')
    call(page,'paint_edit',{'action':'redo'})
    check('redo pointer stroke',call(page,'paint_get_pixels',{'points':[{'x':10,'y':10}]})['pixels'][0]['color']=='#000000')
    call(page,'paint_new',{'width':400,'height':300})
    for i,kind in enumerate(['rect','ellipse','roundrect']):
        call(page,'paint_shape',{'kind':kind,'x':10+i*120,'y':20,'width':90,'height':65,'color':'#000000','background':'#ff0000','fillStyle':'filled','size':2})
    check('rectangle/ellipse/roundrect background fills',all(x['color']=='#ff0000' for x in call(page,'paint_get_pixels',{'points':[{'x':40,'y':50},{'x':170,'y':50},{'x':290,'y':50}]})['pixels']))
    call(page,'paint_fill',{'x':40,'y':50,'color':'#00ff00'})
    check('worker flood fill respects black border', [x['color'] for x in call(page,'paint_get_pixels',{'points':[{'x':40,'y':50},{'x':10,'y':20},{'x':5,'y':5}]})['pixels']]==['#00ff00','#000000','#ffffff'])
    call(page,'paint_selection',{'action':'create','x':10,'y':20,'width':90,'height':65})
    call(page,'paint_selection',{'action':'copy'})
    call(page,'paint_selection',{'action':'move','x':10,'y':110})
    call(page,'paint_selection',{'action':'commit'})
    check('selection moved, old pixels cleared', [x['color'] for x in call(page,'paint_get_pixels',{'points':[{'x':40,'y':50},{'x':40,'y':140}]})['pixels']]==['#ffffff','#00ff00'])
    call(page,'paint_selection',{'action':'paste','x':250,'y':110})
    call(page,'paint_selection',{'action':'resize','width':45,'height':32})
    call(page,'paint_transform',{'type':'rotate','angle':'90'})
    check('selection resize and rotate changes dimensions',call(page,'paint_get_state')['selection']['width']==32)
    call(page,'paint_selection',{'action':'commit'})
    call(page,'paint_edit',{'action':'invert'})
    check('invert swaps background to black',call(page,'paint_get_pixels',{'points':[{'x':5,'y':5}]})['pixels'][0]['color']=='#000000')
    call(page,'paint_edit',{'action':'undo'})
    check('undo invert restores pixels',call(page,'paint_get_pixels',{'points':[{'x':5,'y':5}]})['pixels'][0]['color']=='#ffffff')
    call(page,'paint_text',{'x':120,'y':140,'text':'Paint XP\nHello, world!','size':19,'color':'#000080','width':200,'height':70,'bold':True,'opaque':False})
    text_image=call(page,'paint_export',{'format':'png'})
    im=Image.open(io.BytesIO(base64.b64decode(text_image['data'])))
    check('text is rasterized into document',any(px[:3]!=(255,255,255) for px in im.crop((120,140,230,180)).getdata()))
    for fmt in ['png','jpeg','webp','bmp','bmpmono','bmp16','bmp256','gif','tiff']:
        exported=call(page,'paint_export',{'format':fmt})
        encoded=base64.b64decode(exported['data']);decoded=Image.open(io.BytesIO(encoded));decoded.load()
        check(f'{fmt} export independently decoded by Pillow',decoded.size==(400,300))
    png=call(page,'paint_export',{'format':'png'})
    call(page,'paint_new',{'width':50,'height':50})
    call(page,'paint_import',{'base64':png['data'],'mime':'image/png','name':'roundtrip.png'})
    check('PNG import restores dimensions',call(page,'paint_get_state')['width']==400)
    # Test every tool via pointer gestures, plus curve and polygon multi-stage tools.
    call(page,'paint_new',{'width':640,'height':420})
    r=page.locator('#overlay').bounding_box()
    def drag(x0,y0,x1,y1,button='left'):
        page.mouse.move(r['x']+3+x0,r['y']+3+y0);page.mouse.down(button=button);page.mouse.move(r['x']+3+x1,r['y']+3+y1,steps=8);page.mouse.up(button=button)
    for i,tool in enumerate(['pencil','brush','airbrush','eraser','line','rect','ellipse','roundrect']):
        page.locator(f'[data-tool="{tool}"]').click();drag(20+i*65,40,65+i*65,85)
    check('eight pointer drawing tools finish transactions',page.evaluate('window.paintXP.app.doc.transaction===null'))
    page.locator('[data-tool="curve"]').click();drag(30,125,200,125);drag(70,120,70,90);drag(160,130,160,170)
    check('three-stage curve completes',page.evaluate('window.paintXP.app.curve===null'))
    page.locator('[data-tool="polygon"]').click()
    for x,y in [(240,120),(320,120),(300,180)]:page.mouse.click(r['x']+3+x,r['y']+3+y)
    page.keyboard.press('Enter')
    check('polygon commits on Enter',page.evaluate('window.paintXP.app.poly===null'))
    page.locator('[data-tool="free-select"]').click()
    drag(10,30,80,100);page.keyboard.press('Escape')
    check('freeform selection cancels',call(page,'paint_get_state')['selection'] is None)
    page.locator('[data-tool="text"]').click();drag(30,230,330,280);page.locator('.text-editor').fill('The quick brown fox');page.locator('#font-bold').click();page.locator('[data-tool="pencil"]').click()
    check('text-box editing commits on tool switch',page.locator('.text-editor').count()==0 and call(page,'paint_get_state')['modified'])
    # Original menus and modal field control.
    page.locator('[data-menu="Image"]').click();page.locator('[data-command="attributes"]').click()
    check('Attributes dialog opens',page.get_by_role('dialog',name='Attributes',exact=True).count()==1)
    page.locator('[name="width"]').fill('700');page.locator('[name="height"]').fill('450');page.get_by_role('button',name='OK',exact=True).click();page.wait_for_timeout(100)
    check('Attributes resizes real document',call(page,'paint_get_state')['width']==700)
    call(page,'paint_ui',{'action':'command','target':'edit-colors'});page.locator('#define-custom').click();page.locator('[name="red"]').fill('12');page.locator('[name="green"]').fill('34');page.locator('[name="blue"]').fill('56');page.screenshot(path=str(OUTPUT/'edit-colors.png'));page.get_by_role('button',name='OK',exact=True).click();page.wait_for_timeout(100)
    check('RGB color dialog applies edited color',call(page,'paint_get_state')['foreground']=='#0c2238')
    for command in ['flip-rotate','stretch-skew','zoom-custom','page-setup','print-preview','help','about','diagnostics','mcp']:
        call(page,'paint_ui',{'action':'command','target':command});page.wait_for_timeout(70)
        check(f'{command} dialog opens without errors',call(page,'paint_get_state')['dialog'] is not None)
        call(page,'paint_ui',{'action':'close'})
    call(page,'paint_ui',{'action':'command','target':'view-bitmap'})
    check('View Bitmap opens full-screen image',page.locator('#bitmap-view').count()==1)
    page.keyboard.press('Escape')
    check('View Bitmap closes with Escape',page.locator('#bitmap-view').count()==0)
    # Sparse large-canvas behavior; no massive surface allocation.
    call(page,'paint_new',{'width':16384,'height':16384})
    check('268 MP blank document has zero allocated tiles',call(page,'paint_get_state')['renderer']['allocatedTiles']==0)
    call(page,'paint_stroke',{'points':[{'x':16000,'y':16000},{'x':16020,'y':16020}],'color':'#ff0000'})
    check('distant stroke allocates one tile',call(page,'paint_get_state')['renderer']['allocatedTiles']==1)
    page.wait_for_timeout(50)
    before_scroll=call(page,'paint_get_state')['view']['scrollX']
    page.get_by_role('button',name='Scroll right',exact=True).click()
    check('XP scrollbar arrow pans the document',call(page,'paint_get_state')['view']['scrollX']>before_scroll)
    bar=page.get_by_role('scrollbar',name='Horizontal canvas scroll')
    bar.focus();page.keyboard.press('End')
    check('XP scrollbar keyboard End reaches document edge',call(page,'paint_get_state')['view']['scrollX']>15000)
    check('XP scrollbar thumb is visible for overflowing canvas',page.locator('.horizontal .scroll-thumb').is_visible())
    rejected=page.evaluate("async()=>{try{await paintXP.execute('paint_fill',{x:0,y:0,color:'#000000'});return false;}catch(e){return /pixel|dense|64/i.test(e.message);}}")
    check('oversized nonblank dense flood is rejected without allocation',rejected and call(page,'paint_get_state')['renderer']['allocatedTiles']==1)
    blocked=page.evaluate("async()=>{paintXP.app.busy=true;try{await paintXP.execute('paint_set_colors',{foreground:'#0000ff'});return false;}catch(e){return e.message.includes('operation');}finally{paintXP.app.busy=false;}}")
    check('agent edits cannot race an in-progress worker operation',blocked)
    call(page,'paint_view',{'scrollX':15700,'scrollY':15700})
    page.wait_for_timeout(100)
    check('viewport canvas stays viewport-sized',page.locator('#overlay').evaluate('(c)=>c.width<2000&&c.height<2000'))
    preview=call(page,'paint_export',{'format':'png','maxDimension':1024})
    check('large sparse preview is downsampled without giant canvas',preview['width']==1024 and preview['height']==1024)
    # Draw a demonstration picture using real editing commands.
    demo=json.loads((ROOT/'tests'/'demo.json').read_text())
    call(page,'paint_batch',{'operations':demo})
    page.wait_for_timeout(200)
    page.screenshot(path=str(OUTPUT/'desktop-drawing.png'))
    check('no uncaught desktop JavaScript errors',not errors)
    # Mobile, using genuine touch events and a second-finger pinch sequence.
    mobile=browser.new_context(viewport={'width':390,'height':844},device_scale_factor=2,is_mobile=True,has_touch=True)
    mp=mobile.new_page();mobile_errors=[];mp.on('pageerror',lambda e:mobile_errors.append(str(e)));load(mp)
    call(mp,'paint_batch',{'operations':demo})
    call(mp,'paint_view',{'zoom':0.45,'touch':True})
    call(mp,'paint_set_tool',{'tool':'brush','size':4})
    r=mp.locator('#overlay').bounding_box();cdp=mobile.new_cdp_session(mp)
    def touch(kind,points):cdp.send('Input.dispatchTouchEvent',{'type':kind,'touchPoints':points})
    touch('touchStart',[{'x':r['x']+30,'y':r['y']+240,'id':1}]);touch('touchMove',[{'x':r['x']+110,'y':r['y']+265,'id':1}]);touch('touchEnd',[])
    check('touch stroke creates an undoable edit',call(mp,'paint_get_state')['history']['undo']>0)
    z=call(mp,'paint_get_state')['view']['zoom']
    touch('touchStart',[{'x':r['x']+80,'y':r['y']+180,'id':1}]);touch('touchStart',[{'x':r['x']+80,'y':r['y']+180,'id':1},{'x':r['x']+160,'y':r['y']+180,'id':2}]);touch('touchMove',[{'x':r['x']+50,'y':r['y']+180,'id':1},{'x':r['x']+190,'y':r['y']+180,'id':2}]);touch('touchEnd',[])
    check('two-finger pinch changes zoom',call(mp,'paint_get_state')['view']['zoom']>z)
    call(mp,'paint_view',{'zoom':.36,'scrollX':0,'scrollY':0});mp.wait_for_timeout(200);mp.screenshot(path=str(OUTPUT/'mobile.png'))
    check('mobile does not overflow horizontally',mp.evaluate('document.documentElement.scrollWidth===innerWidth'))
    check('no uncaught mobile JavaScript errors',not mobile_errors)
    report={'passed':len(results),'tests':results,'renderer':call(page,'paint_get_state')['renderer'],'desktopErrors':errors,'mobileErrors':mobile_errors,'mode':'HTTP' if os.environ.get('PAINT_TEST_URL') else 'standalone injected into about:blank; Canvas 2D fallback, not a WebGPU execution test'}
    (ROOT/'docs'/'browser-test-results.json').write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    browser.close()
