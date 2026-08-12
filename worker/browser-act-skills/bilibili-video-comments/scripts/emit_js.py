import sys

action = sys.argv[1] if len(sys.argv) > 1 else "comments"
target = 200 if len(sys.argv) > 2 and sys.argv[2] == "200" else 100

def emit(value):
    print(value.encode("ascii", "backslashreplace").decode("ascii"))

if action == "playback":
    emit(r"""(async()=>{
      const video=document.querySelector('video');
      if(!video)return JSON.stringify({playerReady:false,errorCode:'PLAYER_NOT_FOUND'});
      const captions=[...document.querySelectorAll('[class*=subtitle]')].map(x=>String(x.textContent||'').trim()).filter(Boolean).slice(0,20).join(' ').slice(0,4000);
      let playbackStarted=false,errorCode='';
      try{
        video.pause();video.currentTime=0;
        await new Promise((resolve,reject)=>{if(video.readyState>=2)return resolve();const timer=setTimeout(()=>reject(new Error('PLAYER_TIMEOUT')),5000);video.addEventListener('loadeddata',()=>{clearTimeout(timer);resolve()},{once:true})});
        await video.play();playbackStarted=!video.paused;
      }catch(error){errorCode=String(error?.message||'PLAYBACK_FAILED').slice(0,80)}
      return JSON.stringify({playerReady:playbackStarted&&video.readyState>=2,playbackStarted,errorCode,title:String(document.title||'').slice(0,200),durationMs:Number.isFinite(video.duration)?Math.round(video.duration*1000):0,width:video.videoWidth||0,height:video.videoHeight||0,muted:Boolean(video.muted),captions,atStart:video.currentTime<1})
    })()""")
else:
    script = r"""(async()=>{
      const target=__TARGET__,delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      const clean=value=>String(value||'').replace(/^回复\s+@[^:：]{1,80}[:：]\s*/i,'').replace(/@[\w\u4e00-\u9fff-]{1,40}/g,'@匿名用户').replace(/\s+/g,' ').trim().slice(0,2000);
      const anonymousId=text=>{let hash=2166136261;for(const ch of text){hash^=ch.codePointAt(0);hash=Math.imul(hash,16777619)}return`comment-${(hash>>>0).toString(16).padStart(8,'0')}`};
      const seen=new Map(),processed=new Set(),pages=new Set();let fetchErrors=0;
      const validUrl=value=>{try{const url=new URL(value);return url.protocol==='https:'&&url.hostname==='api.bilibili.com'&&url.pathname==='/x/v2/reply/wbi/main'?url.toString():''}catch{return''}};
      const observed=Array.isArray(globalThis.__SHOTPRINT_OBSERVED_COMMENT_URLS__)?globalThis.__SHOTPRINT_OBSERVED_COMMENT_URLS__:[];
      const urls=new Set(observed.map(validUrl).filter(Boolean));
      const gate=()=>{const text=[document.title,...[...document.querySelectorAll('h1,h2,[role=alert],[role=dialog]')].slice(0,20).map(x=>x.textContent||'')].join(' | ').toLowerCase();if(/captcha|安全验证|滑块/.test(text))return'CAPTCHA_REQUIRED';if(/403 forbidden|access denied|you have been blocked/.test(text))return'HTTP_403';if(/(?:^|\s)429(?:\s|$)|too many requests|请求过于频繁/.test(text))return'HTTP_429';if(/登录后.*评论|请先登录/.test(text))return'LOGIN_REQUIRED';return''};
      const add=reply=>{const text=clean(reply?.content?.message);if(!text||seen.has(text))return;seen.set(text,{anonymousId:anonymousId(text),text,likes:Number(reply?.like)||0,timeLabel:reply?.ctime?new Date(Number(reply.ctime)*1000).toISOString().slice(0,10):undefined,replyTo:Boolean(reply?.parent&&String(reply.parent)!=='0')});for(const child of Array.isArray(reply?.replies)?reply.replies:[])add(child)};
      const initialError=gate();if(initialError)return JSON.stringify({comments:[],engine:'browser-act-network',strategyVersion:'bilibili-wbi-ui-v2',cursorCount:0,pageCount:0,stopReason:'blocked',errorCode:initialError,warnings:[]});
      document.querySelector('bili-comments,#commentapp,#comment')?.scrollIntoView({block:'start'});await delay(1200);
      let noGrowth=0;
      for(let round=0;round<15&&seen.size<target;round++){
        const blocked=gate();if(blocked)break;
        const before=seen.size;
        for(const value of performance.getEntriesByType('resource').map(x=>x.name)){const url=validUrl(value);if(url)urls.add(url)}
        for(const url of [...urls]){if(processed.has(url))continue;processed.add(url);try{const response=await fetch(url,{credentials:'include'});if(response.status===403)return JSON.stringify({comments:[...seen.values()],engine:'browser-act-network',strategyVersion:'bilibili-wbi-ui-v2',cursorCount:processed.size,pageCount:pages.size,stopReason:'blocked',errorCode:'HTTP_403',warnings:[]});if(response.status===429)return JSON.stringify({comments:[...seen.values()],engine:'browser-act-network',strategyVersion:'bilibili-wbi-ui-v2',cursorCount:processed.size,pageCount:pages.size,stopReason:'blocked',errorCode:'HTTP_429',warnings:[]});const data=await response.json();if(data?.code===0){pages.add(url);for(const reply of data?.data?.replies||[])add(reply)}else fetchErrors++}catch{fetchErrors++}}
        noGrowth=seen.size===before?noGrowth+1:0;if(noGrowth>=3&&round>=5)break;
        window.scrollTo(0,document.body.scrollHeight);await delay(1200);
      }
      const roots=[document,...[...document.querySelectorAll('*')].map(x=>x.shadowRoot).filter(Boolean)];for(const root of roots){for(const element of root.querySelectorAll?.('.reply-content,#contents,.contents')||[]){const text=clean(element.textContent);if(text&&!seen.has(text))seen.set(text,{anonymousId:anonymousId(text),text,likes:0,replyTo:false})}}
      const errorCode=gate()||(!seen.size?'NETWORK_RESPONSE_CHANGED':'');const warnings=[];if(fetchErrors)warnings.push(`${fetchErrors}个页面响应读取失败`);if(seen.size<target)warnings.push('页面在有界采集内只返回了部分评论。');
      return JSON.stringify({title:String(document.title||'').slice(0,200),comments:[...seen.values()].slice(0,target),engine:pages.size?'browser-act-network':'browser-act-dom',strategyVersion:'bilibili-wbi-ui-v2',cursorCount:processed.size,pageCount:pages.size,stopReason:errorCode?'blocked':seen.size>=target?'target_reached':'no_growth',sortMode:'current-page-order',errorCode,warnings})
    })()"""
    emit(script.replace("__TARGET__", str(target)))
