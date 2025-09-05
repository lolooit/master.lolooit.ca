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
    
    // استفاده از AWS credentials - در console وارد کنید:
    // window.AWS_ACCESS_KEY = 'your-access-key'
    // window.AWS_SECRET_KEY = 'your-secret-key'
    
    // استفاده از Environment Variables از Amplify
    AWS.config.credentials = new AWS.Credentials({
      accessKeyId: 'YOUR_ACCESS_KEY_HERE',
      secretAccessKey: 'YOUR_SECRET_KEY_HERE'
    });
    log('AWS credentials ready.');

    const kv = new AWS.KinesisVideo({ region: REGION, credentials: AWS.config.credentials });

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

    signalingClient.on('open', async () => {
      log('Signaling OPEN. Creating offer...');
      const offer = await pc.createOffer({ offerToReceiveAudio: false, offerToReceiveVideo: false });
      await pc.setLocalDescription(offer);
      signalingClient.sendSdpOffer(pc.localDescription);
    });

    signalingClient.on('sdpAnswer', async answer => { log('Got SDP answer'); await pc.setRemoteDescription(answer); });
    signalingClient.on('iceCandidate', cand => { log('Remote ICE'); pc.addIceCandidate(cand); });

    pc.onicecandidate = ({ candidate }) => { if (candidate) signalingClient.sendIceCandidate(candidate); };
    pc.onconnectionstatechange = () => log('PC state:', pc.connectionState);

    signalingClient.open();
    log('MASTER started.');
  } catch (err) {
    console.error(err); log('ERROR:', err && (err.message || JSON.stringify(err)));
    alert('Error: ' + (err?.message || err));
  }
};