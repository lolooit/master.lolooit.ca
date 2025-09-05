const logEl = document.getElementById('log');
const log = (...args) => { console.log(...args); logEl.textContent += args.join(' ') + '\n'; };

const cfg = window.APP_CONFIG;
document.getElementById('region').value = cfg.REGION;
document.getElementById('identityPool').value = cfg.IDENTITY_POOL_ID;

document.getElementById('startBtn').onclick = async () => {
  try {
    const REGION = document.getElementById('region').value.trim();
    const CHANNEL = cfg.CHANNEL_NAME;

    log('Init AWS...');
    AWS.config.region = REGION;
    




    // استفاده از Config
    AWS.config.credentials = new AWS.Credentials({
      accessKeyId: cfg.ACCESS_KEY,
      secretAccessKey: cfg.SECRET_KEY
    });
    log('AWS credentials ready.');

    const kv = new AWS.KinesisVideo({ region: REGION, credentials: AWS.config.credentials });
//swdwsdw//

    log('DescribeSignalingChannel...');
    log('Trying to access channel:', CHANNEL);
    log('Using region:', REGION);
    
    const { ChannelInfo } = await kv.describeSignalingChannel({ ChannelName: CHANNEL }).promise();
    const channelArn = ChannelInfo.ChannelARN;

    log('GetSignalingChannelEndpoint (MASTER)...');
    const { ResourceEndpointList } = await kv.getSignalingChannelEndpoint({
      ChannelARN: channelArn,
      SingleMasterChannelEndpointConfiguration: { Protocols: ['WSS','HTTPS'], Role: 'MASTER' }
    }).promise();

    const endpoints = {};
    (ResourceEndpointList || []).forEach(e => endpoints[e.Protocol] = e.ResourceEndpoint);

    const kvsSig = new AWS.KinesisVideoSignalingChannels({
      region: REGION, endpoint: endpoints.HTTPS, credentials: AWS.config.credentials
    });

    log('GetIceServerConfig...');
    const ice = await kvsSig.getIceServerConfig({ ChannelARN: channelArn }).promise();
    const iceServers = [{ urls: `stun:stun.kinesisvideo.${REGION}.amazonaws.com:443` }];
    (ice.IceServerList || []).forEach(s => iceServers.push({ urls: s.Uris, username: s.Username, credential: s.Password }));

    const pc = new RTCPeerConnection({ iceServers });
    const localVideo = document.getElementById('localVideo');

    log('getUserMedia...');
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(t => pc.addTrack(t, stream));
    localVideo.srcObject = stream;

    const signalingClient = new KVSWebRTC.SignalingClient({
      channelARN: channelArn,
      channelEndpoint: endpoints.WSS,
      role: KVSWebRTC.Role.MASTER,
      region: REGION,
      credentials: AWS.config.credentials,
      systemClockOffset: kv.config.systemClockOffset
    });

    signalingClient.on('open', () => {
      log('Signaling OPEN. Waiting for offer from viewer...');
    });

    signalingClient.on('sdpOffer', async (offer, remoteClientId) => {
      viewerClientId = remoteClientId;
      log('Got SDP offer from viewer:', remoteClientId);
      try {
        await pc.setRemoteDescription(offer);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        signalingClient.sendSdpAnswer(pc.localDescription, remoteClientId);
        log('SDP answer sent to viewer');
      } catch (err) {
        log('Error handling offer:', err.message);
      }
    });
    
    signalingClient.on('iceCandidate', async (candidate, remoteClientId) => { 
      log('Remote ICE candidate from viewer'); 
      try {
        await pc.addIceCandidate(candidate);
      } catch (err) {
        log('Error adding ICE candidate:', err.message);
      }
    });
    
    signalingClient.on('error', (error) => {
      log('Signaling error:', error.message);
    });

    let viewerClientId = null;
    
    pc.onicecandidate = ({ candidate }) => { 
      if (candidate && viewerClientId) {
        log('Sending ICE candidate to viewer');
        signalingClient.sendIceCandidate(candidate, viewerClientId);
      }
    };
    pc.onconnectionstatechange = () => {
      log('PC state:', pc.connectionState);
      if (pc.connectionState === 'connected') {
        log('✅ WebRTC connection established!');
      } else if (pc.connectionState === 'failed') {
        log('❌ WebRTC connection failed');
      }
    };

    signalingClient.open();
    log('MASTER started.');
  } catch (err) {
    console.error(err); log('ERROR:', err && (err.message || JSON.stringify(err)));
    alert('Error: ' + (err?.message || err));
  }
};