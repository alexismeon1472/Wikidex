const WD_HEARTBEAT_MS=2500;

function heartbeat(){
  postMessage({
    type:'heartbeat',
    at:Date.now()
  });
}

heartbeat();
setInterval(heartbeat,WD_HEARTBEAT_MS);
