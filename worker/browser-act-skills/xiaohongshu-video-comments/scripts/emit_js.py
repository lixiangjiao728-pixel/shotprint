import sys

action = sys.argv[1] if len(sys.argv) > 1 else "comments"
target = 200 if len(sys.argv) > 2 and sys.argv[2] == "200" else 100

def emit(value):
    print(value.encode("ascii", "backslashreplace").decode("ascii"))

if action == "playback":
    emit(r"""(async()=>{const v=document.querySelector('video');if(!v)return JSON.stringify({playerReady:false,errorCode:'PLAYER_NOT_FOUND'});let playbackStarted=false,errorCode='';try{v.pause();v.currentTime=0;await v.play();playbackStarted=!v.paused}catch(error){errorCode=String(error?.message||'PLAYBACK_FAILED').slice(0,80)}return JSON.stringify({playerReady:playbackStarted&&v.readyState>=2,playbackStarted,errorCode,title:String(document.title||'').slice(0,200),durationMs:Number.isFinite(v.duration)?Math.round(v.duration*1000):0,width:v.videoWidth||0,height:v.videoHeight||0,muted:Boolean(v.muted),captions:'',atStart:v.currentTime<1})})()""")
else:
    js = r"""(async()=>{
      const target=__TARGET__,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const clean=value=>String(value||'').replace(/^回复\s+@[^:：]{1,80}[:：]\s*/i,'').replace(/@[\w\u4e00-\u9fff-]{1,40}/g,'@匿名用户').replace(/\s+/g,' ').trim().slice(0,2000);
      const anonymousId=text=>{let hash=2166136261;for(const ch of text){hash^=ch.codePointAt(0);hash=Math.imul(hash,16777619)}return`comment-${(hash>>>0).toString(16).padStart(8,'0')}`};
      const gate=()=>{const text=[document.title,...[...document.querySelectorAll('h1,h2,[role=alert],[role=dialog]')].slice(0,20).map(x=>x.textContent||'')].join(' | ').toLowerCase();if(/captcha|安全验证|滑块/.test(text))return'CAPTCHA_REQUIRED';if(/403 forbidden|access denied|you have been blocked/.test(text))return'HTTP_403';if(/(?:^|\s)429(?:\s|$)|too many requests|请求过于频繁/.test(text))return'HTTP_429';if(/登录后.*评论|请先登录|登录后查看/.test(text))return'LOGIN_REQUIRED';return''};
      const initialError=gate();if(initialError)return JSON.stringify({comments:[],engine:'browser-act-dom',strategyVersion:'xiaohongshu-ui-capture-v3',cursorCount:0,pageCount:0,stopReason:'blocked',errorCode:initialError,warnings:[]});
      const noteScroller=document.querySelector('.note-scroller');const scroller=noteScroller&&noteScroller.scrollHeight>noteScroller.clientHeight+80?noteScroller:document.scrollingElement;if(!scroller)return JSON.stringify({comments:[],engine:'browser-act-dom',strategyVersion:'xiaohongshu-ui-capture-v3',cursorCount:0,pageCount:0,stopReason:'blocked',errorCode:'NETWORK_RESPONSE_CHANGED',warnings:['未找到小红书评论滚动容器']});
      const seen=new Map();
      const read=()=>{for(const item of document.querySelectorAll('.comment-item')){const text=clean(item.querySelector('.content .note-text,.content')?.textContent);if(!text||seen.has(text))continue;const likes=Number(String(item.querySelector('.like .count')?.textContent||'').replace(/[^\d.]/g,''))||0;const timeLabel=String(item.querySelector('.date')?.textContent||'').replace(/\s+/g,' ').trim().slice(0,32);seen.set(text,{anonymousId:anonymousId(text),text,likes,timeLabel,replyTo:Boolean(item.closest('.sub-comment-item'))})}};
      let noGrowth=0,rounds=0;read();for(;rounds<15&&seen.size<target;rounds++){const blocked=gate();if(blocked)return JSON.stringify({comments:[...seen.values()].slice(0,target),engine:'browser-act-dom',strategyVersion:'xiaohongshu-ui-capture-v3',cursorCount:0,pageCount:0,scrollCount:rounds,stopReason:'blocked',errorCode:blocked,warnings:[]});const before=seen.size;scroller.scrollTop=scroller.scrollHeight;await delay(800+Math.floor(Math.random()*701));read();noGrowth=seen.size===before?noGrowth+1:0;const atLoadedEnd=scroller.scrollTop+scroller.clientHeight>=scroller.scrollHeight-80;if(noGrowth>=3&&rounds>=5&&atLoadedEnd)break}
      const errorCode=gate()||(!seen.size?'NETWORK_RESPONSE_CHANGED':'');return JSON.stringify({title:String(document.title||'').slice(0,200),comments:[...seen.values()].slice(0,target),engine:'browser-act-dom',strategyVersion:'xiaohongshu-ui-capture-v3',cursorCount:0,pageCount:0,scrollCount:rounds,stopReason:errorCode?'blocked':seen.size>=target?'target_reached':rounds>=15?'scroll_limit':'no_growth',sortMode:'current-page-order',errorCode,warnings:seen.size<target?['页面DOM样本不足，伴侣将合并浏览器已收到的网络响应']:[]})
    })()"""
    emit(js.replace("__TARGET__", str(target)))
