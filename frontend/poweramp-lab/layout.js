/** Independent build1031 geometry model. All public rectangles use CSS pixels.
 * Dimension conversion and placement happen in integer device pixels first.
 * This is a bounded native-derived kernel, not a port of the unresolved FastLayout solver.
 */
import {nativeConfiguration, nativeDimension, NATIVE_EVIDENCE} from './native-values.js';
const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, lo, hi) => Math.max(lo, Math.min(hi, value));
const read = (config, key, fallback) => {
  const v = typeof config?.get === 'function' ? config.get(key) : config?.[key];
  return v === undefined || v === null ? fallback : v;
};
const pick = (config, key, alias, fallback) => read(config, key, read(config,alias,fallback));
export function normalizeConfig(config = {}) {
  const layout = String(pick(config,'alt_layout','layout','Default'));
  const seek = String(pick(config,'seekbar','waveform','scrolling'));
  const font = String(pick(config,'font_variant','font','Bold'));
  const rounding = String(read(config,'rounding','Normal'));
  return {
    skin:read(config,'skin','Black') === 'Light' ? 'Light' : 'Black',
    layout:/FullCover|Full.?Cover|alt_layout2/.test(layout) ? 'FullCover' : /Alternative|overlap_alt_layout/.test(layout) ? 'Alternative' : 'Default',
    seekbar:/plain/i.test(seek) ? 'plain' : /static/i.test(seek) ? 'static' : 'scrolling',
    moreButtons:Boolean(pick(config,'more_buttons','moreButtons',true)),
    font:/System/i.test(font) ? 'System' : /Alternative|AltFont/i.test(font) ? 'Alternative' : 'Bold',
    fontScale:clamp(finite(read(config,'font_scale',1),1),0.5,3),
    rating:clamp(Math.trunc(finite(pick(config,'ratings','rating_type',1),1)),0,3),
    aspect:clamp(Math.trunc(finite(read(config,'aa_aspect',1),1)),0,2),
    rounding:/less/i.test(rounding) ? 'Less' : /none/i.test(rounding) ? 'None' : 'Normal',
    centered:/center/i.test(String(read(config,'track_labels_align','Default'))),
    labelsBackground:!['false','@attr/overlap_track_labels_no_bg'].includes(String(read(config,'labels_bg',true))),
    navbarSeek:Boolean(read(config,'navbar_seekbar',true)), navbarOffset:Boolean(read(config,'navbar_offset',false)),
    hideStatusBar:Boolean(read(config,'hide_status_bar',false)), hideMenu:Boolean(read(config,'hide_menu',false)),
    subaa:read(config,'subaa',null), subaaCentered:Boolean(read(config,'subaa_centered',true)),
    subaaSmall:Boolean(read(config,'subaa_small',false)), subaaTwoLines:Boolean(read(config,'subaa_two_lines',false)),
    subaaNoGap:Boolean(read(config,'subaa_no_gap',false)), showCounter:Boolean(read(config,'show_counter',false)),
    playing:Boolean(read(config,'playing',false)),
    background:{enabled:Boolean(read(config,'background_enabled',true)),blur:finite(read(config,'background_blur',5),5), saturation:finite(read(config,'background_saturation',150),150),intensity:finite(read(config,'background_intensity',100),100),gradient:finite(read(config,'background_gradient',4),4)}
  };
}
/** Native single-line eatFontPads contract, using caller-provided Paint-compatible metrics. */
export function textMetricKernel(metrics, padding = {}) {
  if (!metrics || !Number.isFinite(metrics.zTop) || !Number.isFinite(metrics.zBottom)) return null;
  return {width:Math.ceil(Math.max(0, finite(metrics.width,0))) + (padding.left||0)+(padding.right||0),
    height:metrics.zBottom-metrics.zTop+(padding.top||0)+(padding.bottom||0), baseline:(padding.top||0)-metrics.zTop};
}
/** Foreground AAImageView matrix contract: fitCenter is intentionally not CSS contain. */
export function resolveArtworkCrop(sourceWidth, sourceHeight, targetWidth, targetHeight, aspect = 1) {
  const sw = finite(sourceWidth,0), sh = finite(sourceHeight,0), tw = Math.max(0,targetWidth), th = Math.max(0,targetHeight);
  if (sw <= 0 || sh <= 0 || tw <= 0 || th <= 0) return {known:false, reason:'Artwork dimensions unavailable'};
  const portraitContain = aspect === 1 && sw + 16 < sh;
  const scale = portraitContain ? Math.min(tw/sw,th/sh) : aspect === 2 ? (sh >= sw ? tw/sw : th/sh) : tw/sw;
  return {known:true, scale, x:(tw-sw*scale)/2, y:(th-sh*scale)/2, width:sw*scale,height:sh*scale,
    mode:portraitContain ? 'portrait-center' : aspect === 2 ? 'orientation-crop' : 'width-fit', mirrorEdges:true,
    clipRect:{x:(tw-Math.min(tw,sw*scale))/2,y:(th-Math.min(th,sh*scale))/2,width:Math.min(tw,sw*scale),height:Math.min(th,sh*scale)},
    evidence:'AAImageView.К; PA1031 rendering matrix investigation'};
}
export function resolveLayout(config = {}, viewport = {}, track = {}) {
  const c = normalizeConfig(config), q = nativeConfiguration(viewport);
  const dpr = Math.max(0.25,finite(viewport.dpr,1));
  const W = Math.round(q.width*dpr), H = Math.round(q.height*dpr), landscape = q.orientation === 'land';
  const fontScale = Math.max(0.1,finite(viewport.fontScale,1))*c.fontScale;
  const gaps = ['Native FastLayout recursive consumption/scene interpolation is bounded; this module resolves settled core geometry.',
    'Proprietary fonts are not redistributed; browser font metrics differ until validated against a native oracle.'];
  if (q.api >= 34 && fontScale !== 1 && !viewport.spToPx) gaps.push('Nonlinear Android API34+ SP conversion unavailable: explicit linear browser scaling is used.');
  const px = (value, unit='dp', mode='size') => {
    const v = unit === 'px' ? value : unit === 'sp' && viewport.spToPx ? viewport.spToPx(value,fontScale,dpr) : value*dpr*(unit === 'sp' ? fontScale : 1);
    return mode === 'float' ? v : mode === 'offset' ? Math.trunc(v) : (v === 0 ? 0 : Math.round(v) || (v > 0 ? 1 : -1));
  };
  const selected = {};
  const dim = (name, mode='size') => { const v = nativeDimension(name,q); selected[name]=v; return px(v.value,v.unit,mode); };
  const rawInsets = viewport.insets || {};
  const I = Object.fromEntries(['top','right','bottom','left'].map(key => [key,Math.max(0,Math.round(finite(rawInsets[key],0)*dpr))]));
  if (q.api >= 29 && I.bottom > px(2) && I.bottom <= px(25) && !viewport.insetsAreEffective) I.bottom = Math.max(0,I.bottom-px(4));
  if (q.api >= 30 && c.hideStatusBar) I.top = 0;
  const rect = (x,y,width,height,extra={}) => ({x:x/dpr,y:y/dpr,width:Math.max(0,width)/dpr,height:Math.max(0,height)/dpr,...extra});
  const navHeight = dim('navbarHeight','offset'), navMargin = c.rounding === 'Less' ? px(4,'dp','offset') : dim('navbarBottom','offset');
  const navBottom = c.navbarOffset ? px(12) : navMargin;
  const navSide = px(c.navbarOffset ? 12 : 8);
  const normalRef = navBottom+navHeight, miniRef = navBottom+2*navHeight+px(4,'dp','offset')-px(4,'dp','offset');
  const thirdRef = miniRef-px(6,'dp','offset')+px(32,'dp','offset');
  const navbarY = H-I.bottom-navBottom-navHeight;
  const navRadius = c.rounding === 'None' ? 0 : c.rounding === 'Less' ? px(8) : dim('navbarRadius');
  const navbar = rect(I.left+navSide,navbarY,W-I.left-I.right-2*navSide,navHeight,{radius:navRadius/dpr,reference:normalRef/dpr,iconSize:dim('navbarIcon')/dpr});
  const miniHeight = navHeight, miniY = H-I.bottom-(c.navbarSeek ? thirdRef : miniRef);
  const mini = rect(I.left+navSide,miniY,W-I.left-I.right-2*navSide,miniHeight,{artSize:dim('miniArt')/dpr,artRadius:dim('miniRadius')/dpr,seek:c.navbarSeek,seekHeight:c.navbarSeek?px(32)/dpr:0,totalReference:(c.navbarSeek?thirdRef:miniRef)/dpr});
  const alternate = c.layout !== 'Default';
  const artPad = landscape ? 0 : c.layout === 'FullCover' ? dim('fullPadding') : alternate ? dim('altPadding') : 0;
  const reserve = landscape ? normalRef : alternate ? dim('altReserve','offset') : dim('artReserve','offset');
  const minimum = alternate ? px(50) : px(130,'sp');
  const U = Math.max(minimum,W-I.left-I.right), V = Math.max(minimum,H-I.top-I.bottom-artPad-reserve);
  const side = Math.round(Math.max(minimum,Math.min(U,V)));
  const autoWide = V <= px(290) && U/V >= 1.85;
  const left = landscape || autoWide ? I.left : Math.round(Math.floor(W/2)-side/2);
  const top = I.top;
  const itemWidth = landscape && alternate ? W-I.left-I.right : side;
  const item = rect(left,top,itemWidth,side+artPad,{artSide:side/dpr,paddingBottom:artPad/dpr,owner:'AAItemView inside ListWidget'});
  const artInset = px(8), frame = rect(left+artInset,top+artInset,side-2*artInset,side-2*artInset);
  const playing = Boolean(track.playing ?? c.playing), scale = playing ? 1 : 0.975;
  const artSize = Math.max(0,side-2*artInset);
  const radius = c.rounding === 'None' ? 0 : px(c.rounding === 'Less'?12:18.75,'dp','float');
  const art = rect(left+artInset+artSize*(1-scale)/2,top+artInset+artSize*(1-scale)/2,artSize*scale,artSize*scale,{radius:radius*scale/dpr,scale,frame,owner:'AAImageView',crop:resolveArtworkCrop(track.artWidth,track.artHeight,artSize/dpr,artSize/dpr,c.aspect)});
  const fontKeys = c.font === 'Alternative' ? ['altTitleFont','altSecondaryFont'] : ['titleFont','secondaryFont'];
  const families = {System:'system-ui, sans-serif',Alternative:'Manrope, sans-serif',Bold:'system-ui, sans-serif'};
  const metricInputs = viewport.textMetrics || track.textMetrics || {};
  const textSpecs = fontKeys.map((key,index) => {
    const fontPx = dim(key), metricKey = index ? 'secondary':'title';
    const metric = textMetricKernel(metricInputs[metricKey]);
    if (!metric) gaps.push(`${metricKey}: browser fallback metric box; supply Z bounds/advance for exact native single-line height.`);
    // Fallback equals the requested font em, never labelled a measured glyph extent.
    return {height:metric ? Math.round(metric.height*dpr) : fontPx, baseline:metric ? metric.baseline : null,
      fontSize:fontPx/dpr,fontFamily:families[c.font],fontRole:c.font,fontWeight:c.font==='Bold'?700:400,metricSource:metric?'caller':'browser-em-fallback',advanceWidth:metric?metric.width:null};
  });
  const [t,s] = textSpecs, labelMargin = landscape && alternate ? 0 : alternate ? px(14) : dim('labelMargin');
  let textX = left+labelMargin, textWidth = itemWidth-2*labelMargin, ty, sy;
  const ratingVisible = c.rating === 1 || c.rating === 2;
  const ratingIcon=dim('ratingIcon');
  const ratingHeight = ratingIcon+px(12), ratingMargin = alternate ? px(6) : dim('labelMargin');
  let ratingY = top+side-ratingMargin-ratingHeight;
  if (landscape && alternate) {
    textX = left+side; textWidth = W-I.right-px(8)-textX;
    ty = top+px(12); sy=ty+t.height+px(2);
    if (c.layout === 'FullCover') ratingY=sy+s.height+px(2);
  } else if (c.layout === 'Default') {
    const bottomAnchor = ratingVisible ? ratingY-px(1) : top+side-labelMargin;
    sy=bottomAnchor-s.height; ty=sy-px(1)-t.height;
  } else if (c.layout === 'Alternative') {
    const group=t.height+s.height+px(1);
    ty=top+side+Math.round((artPad-group)/2); sy=ty+t.height+px(.5);
  } else {
    sy=top+side+Math.round((artPad-s.height)/2);
    ty=sy-px(1)-t.height; ratingY=sy+s.height+px(1);
  }
  const labelBg=c.skin==='Light'?(alternate?'#f5f5f555':'#000000c8'):(alternate?'#33333344':'#000000c0');
  const labelRadius=c.rounding==='Less'?8:24;
  const title = rect(textX,ty,textWidth,t.height,{...t,height:t.height/dpr,align:c.centered&&alternate?'center':'left',background:c.labelsBackground,backgroundColor:labelBg,backgroundRadius:labelRadius,overArt:!alternate,owner:'AAItemView'});
  const secondary = rect(textX,sy,textWidth,s.height,{...s,height:s.height/dpr,align:title.align,background:c.labelsBackground,backgroundColor:labelBg,backgroundRadius:labelRadius,overArt:!alternate,owner:'AAItemView',visible:Boolean(track.secondary ?? track.artist ?? track.album ?? true)});
  const rating = rect(landscape&&c.layout==='FullCover'?left+side:left+labelMargin,ratingY,c.rating===2?px(120):(ratingIcon+px(28))*2+px(1),ratingHeight,{visible:ratingVisible,mode:c.rating,overArt:c.layout!=='FullCover'});
  rating.buttons={like:rect(rating.x*dpr,ratingY,ratingIcon+px(28),ratingHeight,{visible:ratingVisible&&c.rating===1}),unlike:rect(rating.x*dpr+ratingIcon+px(29),ratingY,ratingIcon+px(28),ratingHeight,{visible:ratingVisible&&c.rating===1})};
  const actions = (Array.isArray(c.subaa)?c.subaa:['visualization','sleep',c.showCounter?'counter':null,'shuffle','repeat']).slice(0,32).map(a=>a===0||a==='none'?null:String(a||'').replace(/^subaabutton_/, '').replace(/^vis$/,'visualization')||null);
  const slotH=dim('slotHeight'), gap=px(4), subH=c.subaaTwoLines?slotH*2+gap:slotH;
  const subMargin=landscape?0:alternate?px(14):px(8);
  const subX=landscape?left+side:left+subMargin;
  const subWidth=landscape?W-I.right-px(8)-subX:W-2*subMargin;
  const subY=landscape?H-I.bottom-normalRef-px(12)-subH:top+side+artPad+(alternate?px(4):dim('subTop'));
  const baseSlot=dim(c.subaaSmall?'smallSlot':'slotWidth'), count=c.subaaSmall?7:5;
  let slotW=c.subaaCentered?clamp(Math.trunc((subWidth-(count-1)*gap)/count),Math.min(slotH,baseSlot),baseSlot):baseSlot;
  if(c.subaaNoGap) slotW=Math.max(Math.round(baseSlot*.8),Math.min(slotW,Math.trunc((subWidth/2-gap*2)/3)));
  // SubAAButtonsLayout.onLayout: center slot2, fill left/right capacities, then overflow.
  const stride=slotW+gap, sideCapacity=Math.max(0,Math.trunc(Math.trunc((subWidth-slotW)/2)/stride));
  let leftRemaining=sideCapacity,rightRemaining=sideCapacity,leftIndex=0,rightIndex=0;
  let overflow=c.subaaCentered?subWidth+gap:(2*sideCapacity+1)*stride;
  const initialOverflow=overflow;
  const slots=actions.map((action,index)=>{
    const row=c.subaaTwoLines&&index>=16?1:0, i=row?index-16:index;
    if(index===16&&c.subaaTwoLines){leftRemaining=rightRemaining=sideCapacity;leftIndex=rightIndex=0;overflow=initialOverflow;}
    let offset;
    if(i===2) offset=c.subaaCentered?Math.trunc(subWidth/2)-Math.trunc(slotW/2):sideCapacity*stride;
    else if(leftRemaining>0&&(i<2||i>4)){offset=stride*leftIndex++;leftRemaining--;}
    else if(rightRemaining>0&&((i>=3&&i<=4)||i>4)){
      offset=c.subaaCentered?subWidth-slotW-stride*rightIndex:(sideCapacity+rightRemaining)*stride;
      if(!c.subaaCentered)overflow=Math.max(overflow,offset+slotW+gap);
      rightIndex++;rightRemaining--;
    }else{offset=overflow;overflow+=stride;}
    return rect(subX+offset,subY+row*(slotH+gap),slotW,slotH,{action,index,row,visible:true});
  });
  const subart=rect(subX,subY,subWidth,subH,{slots,centered:c.subaaCentered,small:c.subaaSmall,twoLines:c.subaaTwoLines,visualOrder:[0,1,2,4,3]});
  const waveX=landscape?left+side:I.left, waveWidth=landscape?W-I.right-px(8)-waveX:W-I.left-I.right;
  let waveRegionTop, waveRegionBottom;
  if(landscape){
    const preferred=c.seekbar==='plain'?dim('plainLandHeight'):px(160);
    waveRegionTop=alternate?top+px(c.layout==='FullCover'?132:104):top+Math.round((side-preferred)/2);
    waveRegionBottom=Math.min(waveRegionTop+preferred,subY-px(4));
  } else {
    waveRegionTop=subY+subH;
    waveRegionBottom=H-I.bottom-normalRef-(c.seekbar==='plain'?0:px(24));
  }
  const padding=c.seekbar==='plain'?dim('wavePadding'):alternate?px(4):landscape?0:dim('wavePadding');
  const regionBottomPadding=c.seekbar==='plain'?px(24):(landscape&&alternate?px(4):0);
  const regionHeight=Math.max(0,waveRegionBottom-waveRegionTop-padding-regionBottomPadding);
  const cap=landscape&&alternate&&c.seekbar==='scrolling'?px(160):dim('waveMax'), waveH=Math.min(cap,regionHeight);
  const waveY=waveRegionTop+padding+Math.round((regionHeight-waveH)/2);
  const wave=rect(waveX,waveY,waveWidth,waveH,{paddingX:(landscape?0:px(8))/dpr,mode:c.seekbar,bars:c.seekbar==='static'?60:c.seekbar==='scrolling'?100:0,visible:c.seekbar!=='plain',region:rect(waveX,waveRegionTop,waveWidth,waveRegionBottom-waveRegionTop),cursor:'center',owner:'top-controls'});
  const controlMax=dim(alternate?(playing?'altPauseMax':'altPlayMax'):(playing?'pauseMax':'playMax'));
  const buttonOffset=c.seekbar==='plain'?dim(alternate?'altPlainOffset':'plainOffset'):0;
  const controlSize=Math.max(0,Math.min(controlMax,regionHeight-buttonOffset));
  const transportY=waveRegionTop+padding+Math.round((regionHeight-controlSize-buttonOffset)/2);
  const centerX=waveX+Math.round(waveWidth/2), small=dim(alternate?'altSmallButton':'smallButton'), medium=dim(alternate?'altMediumButton':'mediumButton');
  const transport=rect(centerX-controlSize/2,transportY,controlSize,controlSize,{center:rect(centerX-controlSize/2,transportY,controlSize,controlSize),moreButtons:c.moreButtons||c.seekbar==='plain',requestedMoreButtons:c.moreButtons,smallSize:small/dpr,mediumSize:medium/dpr,gap:px(2)/dpr,owner:'top-controls',playing});
  const hasTransportExtras=transport.moreButtons;
  if(playing&&!hasTransportExtras){
    const nw=dim('narrowPauseWidth'),nh=dim('narrowPauseHeight');
    Object.assign(transport,rect(centerX-nw/2,waveRegionTop+padding+Math.round((regionHeight-nh)/2),nw,nh));
    transport.center=rect(centerX-nw/2,waveRegionTop+padding+Math.round((regionHeight-nh)/2),nw,nh);
  }
  const bx=transport.center.x*dpr, by=transport.center.y*dpr, bw=transport.center.width*dpr,bh=transport.center.height*dpr;
  const midY=by+bh/2, med=Math.min(medium,regionHeight), sm=Math.min(small,regionHeight), buttonGap=px(2);
  transport.buttons={
    playPause:{...transport.center,visible:true,action:'playPause'},
    previous:rect(bx-buttonGap-med,midY-med/2,med,med,{visible:hasTransportExtras,action:'previous'}),
    next:rect(bx+bw+buttonGap,midY-med/2,med,med,{visible:hasTransportExtras,action:'next'}),
    previousCategory:rect(bx-2*buttonGap-med-sm,midY-sm/2,sm,sm,{visible:hasTransportExtras,action:'previousCategory'}),
    nextCategory:rect(bx+bw+2*buttonGap+med,midY-sm/2,sm,sm,{visible:hasTransportExtras,action:'nextCategory'})
  };
  const timeH=dim('timeHeight'), timeY=waveY+waveH-timeH-dim('timeBottom','offset');
  const time={elapsed:rect(waveX+px(12),timeY,px(70),timeH),duration:rect(waveX+waveWidth-px(82),timeY,px(70),timeH)};
  const metadata=rect(waveX,H-I.bottom-normalRef-dim('metaBottom')-px(20),waveWidth,px(20),{visible:c.seekbar!=='plain',alpha:playing?1:.75,scale:playing?1:.95});
  const plainH=px(35),plainY=waveRegionTop+padding+Math.round((regionHeight-plainH)/2)+dim('plainTop','offset');
  const plainSeek=rect(waveX+px(14),plainY,waveWidth-px(28),plainH,{visible:c.seekbar==='plain',padding:12});
  const menuIcon=dim('menuIcon'), menuSize=menuIcon+px(16), menuY=c.layout==='FullCover'?ratingY:top+side-labelMargin-menuSize;
  const menu=rect(landscape&&alternate?W-I.right-px(8)-menuSize:left+side-labelMargin-menuSize,menuY,menuSize,menuSize,{visible:!c.hideMenu,scale:c.layout==='FullCover'?.875:.9});
  const lyrics=rect(menu.x*dpr-menuSize-px(1),menuY,menuSize,menuSize,{visible:Boolean(track.lyrics)&&read(config,'main_lyrics_button',1)!==0,scale:menu.scale});
  const miniArt=dim('miniArt'), miniX=mini.x*dpr, miniW=mini.width*dpr;
  mini.art=rect(miniX+px(16),miniY+Math.round((miniHeight-miniArt)/2),miniArt,miniArt,{radius:mini.artRadius});
  mini.playPause=rect(miniX+miniW-px(63),miniY+Math.round((miniHeight-px(48))/2),px(60),px(48));
  const miniTextX=mini.art.x*dpr+miniArt+px(12), miniTextW=Math.max(0,miniX+miniW-px(64)-miniTextX);
  const miniTitleSize=dim(c.font==='Alternative'?'altMiniTitleFont':'miniTitleFont'), miniSecondarySize=dim(c.font==='Alternative'?'altMiniSecondaryFont':'miniSecondaryFont');
  const miniGroupHeight=miniTitleSize+miniSecondarySize+px(8);
  mini.title=rect(miniTextX,miniY+Math.round((miniHeight-miniGroupHeight)/2),miniTextW,miniTitleSize,{fontSize:miniTitleSize/dpr,fontFamily:families[c.font],fontWeight:c.font==='Bold'?700:400});
  mini.secondary=rect(miniTextX,mini.title.y*dpr+miniTitleSize+px(8),miniTextW,miniSecondarySize,{fontSize:miniSecondarySize/dpr,fontFamily:families[c.font],fontWeight:c.font==='Bold'?700:400});
  mini.seekbar=rect(miniX+px(12),miniY+miniHeight,miniW-px(24),px(32),{visible:c.navbarSeek});
  gaps.push('Mini text grouping and menu/lyrics wrap-content bounds use explicit browser metric approximations.');
  const colors=c.skin==='Light'?{primary:'#000000',secondary:'#444444',icon:'#000000',surface:'#ffffff',inverse:'#ffffff',navbar:'#ffffff'}:{primary:'#ffffff',secondary:'#aaaaaa',icon:'#ffffff',surface:'#000000',inverse:'#ffffff',navbar:'#181818'};
  return {width:W/dpr,height:H/dpr,art,item,title,secondary,rating,subart,wave,transport,time,metadata,plainSeek,navbar,mini,colors,
    menu,lyrics,background:c.background,
    effective:{...c,landscape,playing,fontScale,configuration:q,insets:Object.fromEntries(Object.entries(I).map(([k,v])=>[k,v/dpr])),dimensions:selected,artReserve:reserve/dpr,artPadding:artPad/dpr,minimumArt:minimum/dpr},
    fidelity:{status:'native-derived, runtime-unverified',evidence:NATIVE_EVIDENCE,gaps:[...new Set(gaps)],coordinateContract:'CSS px after device-pixel conversion; art is already scaled, frame is unscaled; caller metric inputs use CSS px'}};
}
