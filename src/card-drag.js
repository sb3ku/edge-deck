/* A deliberate hold starts a move; ordinary taps and scrolling stay native. */
(function(root){
  'use strict';
  function attach(container,{onMove,onError=()=>{},onEdge=null,canStart=()=>true,canStack=null}){
    let pending=null,active=null,suppressUntil=0,raf=0;
    const announce=document.createElement('div');announce.className='visually-hidden';announce.setAttribute('role','status');announce.setAttribute('aria-live','polite');document.body.append(announce);
    const say=text=>{announce.textContent=text;};
    // Cards sit in the container, or in the page in front of its home-screen track.
    const isCard=card=>!!card&&(card.parentElement===container||(card.parentElement?.classList.contains('page-grid')&&container.contains(card)));
    const frontPage=()=>container.querySelector(':scope > .home-track > .page-grid[data-current="true"]');
    const cards=()=>[...container.querySelectorAll(':scope > .container-card, :scope > .home-track > .page-grid[data-current="true"] > .container-card')];
    const clearTargets=()=>{cards().forEach(card=>{delete card.dataset.drop;delete card.dataset.dropAxis;});container.querySelectorAll('.page-grid[data-drop]').forEach(grid=>delete grid.dataset.drop);};
    function start(){
      if(!pending||!pending.card.isConnected)return;
      const source=pending;pending=null;delete container.dataset.dragPending;clearTimeout(source.timer);
      const box=source.card.getBoundingClientRect(),ghost=document.createElement('div');
      // A small title preview avoids cloning live iframe/media/interactive content.
      ghost.className='card-drag-preview';ghost.setAttribute('aria-hidden','true');ghost.textContent=source.card.dataset.cardTitle;
      document.body.append(ghost);source.card.dataset.dragging='true';container.dataset.dragging='true';
      active={...source,ghost,offsetX:Math.min(source.x-box.left,160),offsetY:24,target:null,after:false};
      try{container.setPointerCapture(source.pointerId);}catch{}
      document.getSelection()?.removeAllRanges();say(`Moving ${source.card.dataset.cardTitle}. Release to place it. Press Escape to cancel.`);move(source.x,source.y);raf=requestAnimationFrame(scroll);
    }
    function move(x,y){
      if(!active)return;active.x=x;active.y=y;
      active.ghost.style.transform=`translate(${x-active.offsetX}px,${y-active.offsetY}px)`;
      const bounds=container.getBoundingClientRect();
      if(x<bounds.left-20||x>bounds.right+20||y<bounds.top-30||y>bounds.bottom+30){active.target=null;active.page=null;clearTargets();return;}
      const hit=document.elementsFromPoint(x,y).map(node=>node.closest('.container-card')).find(card=>isCard(card)&&card.closest('.page-grid')?.dataset.current!=='false');
      if(hit===active.card){active.target=null;active.page=null;clearTargets();return;}
      // An empty page in front: drop the card onto the page itself.
      const page=frontPage();
      if(page&&!cards().some(card=>card!==active.card)){if(active.page!==page.dataset.page){clearTargets();active.target=null;active.page=page.dataset.page;page.dataset.drop='page';say('Onto this page');}return;}
      active.page=null;
      let target=hit;
      if(!target){
        let distance=Infinity;
        for(const card of cards()){if(card===active.card)continue;const b=card.getBoundingClientRect(),d=Math.hypot(Math.max(b.left-x,0,x-b.right),Math.max(b.top-y,0,y-b.bottom));if(d<distance){distance=d;target=card;}}
      }
      if(!target)return;
      const box=target.getBoundingClientRect(),sourceBox=active.card.getBoundingClientRect();
      const horizontal=Math.abs(sourceBox.top-box.top)<16;
      const after=horizontal?x>box.left+box.width/2:y>box.top+box.height/2;
      // Over the middle of a widget that can take it: a stack, like iOS.
      const into=!!(canStack&&hit===target&&x>box.left+box.width*.22&&x<box.right-box.width*.22&&y>box.top+box.height*.22&&y<box.bottom-box.height*.22&&canStack(active.card.dataset.id,target.dataset.id));
      if(active.target!==target||active.after!==after||active.into!==into){clearTargets();active.target=target;active.after=after;active.into=into;target.dataset.drop=into?'into':after?'after':'before';target.dataset.dropAxis=horizontal?'x':'y';say(into?`Stack with ${target.dataset.cardTitle}`:`${after?'After':'Before'} ${target.dataset.cardTitle}`);}
    }
    function scroll(){
      if(!active)return;const box=container.getBoundingClientRect(),edge=50;
      if(onEdge&&container.querySelector(':scope > .home-track')){
        // Hold at the left or right edge to carry the card to the next page.
        const direction=active.x<box.left+56?-1:active.x>box.right-56?1:0,now=performance.now();
        if(!direction)active.edgeAt=0;else if(!active.edgeAt||active.edgeDirection!==direction){active.edgeAt=now;active.edgeDirection=direction;}
        else if(now-active.edgeAt>650){active.edgeAt=now+500;onEdge(direction);}
      }else{
        if(innerWidth<1000){if(active.y<edge)window.scrollBy(0,-12);else if(active.y>innerHeight-edge)window.scrollBy(0,12);}
        if(active.y<box.top+edge)container.scrollTop-=12;else if(active.y>box.bottom-edge)container.scrollTop+=12;
        if(container.scrollWidth>container.clientWidth){if(active.x<box.left+edge)container.scrollLeft-=12;else if(active.x>box.right-edge)container.scrollLeft+=12;}
      }
      move(active.x,active.y);raf=requestAnimationFrame(scroll);
    }
    function finish(commit){
      if(pending){clearTimeout(pending.timer);pending=null;delete container.dataset.dragPending;}
      if(!active)return;const moving=active;active=null;cancelAnimationFrame(raf);
      suppressUntil=performance.now()+650;delete moving.card.dataset.dragging;delete container.dataset.dragging;clearTargets();moving.ghost.remove();
      try{if(container.hasPointerCapture(moving.pointerId))container.releasePointerCapture(moving.pointerId);}catch{}
      if(commit&&(moving.target||moving.page)){Promise.resolve(onMove(moving.card.dataset.id,moving.target?.dataset.id||null,moving.after,moving.target?null:moving.page,!!moving.into)).then(()=>say(`${moving.card.dataset.cardTitle} moved`)).catch(error=>{say('The card could not be moved.');onError(error);});}
      else say('Move cancelled');
    }
    container.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.isPrimary||active||pending||!canStart())return;
      const card=event.target.closest('.container-card');if(!isCard(card))return;
      const handle=event.target.closest('.card-drag-handle');
      const control=event.target.closest('button,a,input,select,textarea,iframe,[contenteditable=true],[role=button]');
      if(control&&!handle&&!control.matches('.weather-card-open,.printer-open,.widget-shield'))return;
      container.dataset.dragPending='true';pending={card,pointerId:event.pointerId,x:event.clientX,y:event.clientY};pending.timer=setTimeout(start,450);
    });
    document.addEventListener('pointermove',event=>{
      if(pending&&event.pointerId===pending.pointerId&&Math.hypot(event.clientX-pending.x,event.clientY-pending.y)>9){clearTimeout(pending.timer);pending=null;delete container.dataset.dragPending;}
      if(active&&event.pointerId===active.pointerId){event.preventDefault();move(event.clientX,event.clientY);}
    },{passive:false});
    document.addEventListener('touchmove',event=>{if(active)event.preventDefault();},{passive:false,capture:true});
    document.addEventListener('pointerup',event=>{if(event.pointerId===(active||pending)?.pointerId)finish(true);});
    document.addEventListener('pointercancel',event=>{if(event.pointerId===(active||pending)?.pointerId)finish(false);});
    container.addEventListener('lostpointercapture',()=>{if(active)finish(false);});
    container.addEventListener('click',event=>{if(performance.now()<suppressUntil){event.preventDefault();event.stopImmediatePropagation();}},{capture:true});
    container.addEventListener('contextmenu',event=>{if(active||pending)event.preventDefault();});
    document.addEventListener('keydown',event=>{if(event.key==='Escape'&&(active||pending)){event.preventDefault();event.stopPropagation();finish(false);}},{capture:true});
    addEventListener('blur',()=>finish(false));addEventListener('pagehide',()=>finish(false));
    return{cancel:()=>finish(false)};
  }
  root.EdgeCardDrag={attach};
})(window);
