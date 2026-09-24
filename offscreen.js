const worker=new Worker(chrome.runtime.getURL('offscreen-worker.js'));

worker.onmessage=async event=>{
  if(event.data?.type!=='heartbeat')return;

  try{
    await chrome.runtime.sendMessage({
      type:'AUTOBID_HEARTBEAT',
      at:event.data.at||Date.now()
    });
  }catch{}
};
