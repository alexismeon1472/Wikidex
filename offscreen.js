const WD_HEARTBEAT_MS=2500;

async function heartbeat(){
  try{
    await chrome.runtime.sendMessage({
      type:'AUTOBID_HEARTBEAT',
      at:Date.now()
    });
  }catch{}
}

heartbeat();
setInterval(heartbeat,WD_HEARTBEAT_MS);
