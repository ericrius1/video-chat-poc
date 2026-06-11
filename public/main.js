// Two-person WebRTC call with local combined recording.
//
// Recording design: both videos are composited onto one canvas, both audio
// streams are mixed through one AudioContext, and the result goes through a
// single MediaRecorder. One recorder = one clock = audio/video sync is
// structural, with no post-processing or server-side muxing.

const roomId = location.pathname.split("/").pop();

const localVideo = document.getElementById("localVideo");
const remoteVideo = document.getElementById("remoteVideo");
const canvas = document.getElementById("composite");
const ctx2d = canvas.getContext("2d");
const joinBtn = document.getElementById("joinBtn");
const recordBtn = document.getElementById("recordBtn");
const downloadLink = document.getElementById("download");
const statusEl = document.getElementById("status");

document.getElementById("share").textContent =
  `Send this link to the other person: ${location.href}`;

let ws;
let pc;
let localStream;
let remoteStream;
let audioCtx;
let mixedAudioDest;
let recorder;
let drawLoopId;
const pendingCandidates = [];

function setStatus(text) {
  statusEl.textContent = text;
}

// --- call setup ---

joinBtn.onclick = async () => {
  joinBtn.disabled = true;
  try {
    localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480 },
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch (err) {
    setStatus(`camera/mic error: ${err.message}`);
    joinBtn.disabled = false;
    return;
  }
  localVideo.srcObject = localStream;

  const wsProto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${wsProto}://${location.host}`);
  ws.onopen = () => ws.send(JSON.stringify({ type: "join", room: roomId }));
  ws.onmessage = (e) => handleSignal(JSON.parse(e.data));
  ws.onclose = () => setStatus("signaling disconnected");
  setStatus("waiting for other person…");
};

function createPeerConnection() {
  pc = new RTCPeerConnection({
    iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
  });
  for (const track of localStream.getTracks()) {
    pc.addTrack(track, localStream);
  }
  pc.onicecandidate = (e) => {
    if (e.candidate) {
      ws.send(JSON.stringify({ type: "candidate", candidate: e.candidate }));
    }
  };
  pc.ontrack = (e) => {
    if (remoteVideo.srcObject !== e.streams[0]) {
      remoteStream = e.streams[0];
      remoteVideo.srcObject = remoteStream;
    }
  };
  pc.onconnectionstatechange = () => {
    setStatus(`call: ${pc.connectionState}`);
    if (pc.connectionState === "connected") {
      recordBtn.disabled = false;
    } else if (["failed", "disconnected", "closed"].includes(pc.connectionState)) {
      recordBtn.disabled = true;
      if (recorder?.state === "recording") stopRecording();
    }
  };
}

async function handleSignal(msg) {
  switch (msg.type) {
    case "joined":
      if (msg.initiator) {
        // Someone is already waiting in the room — we send the offer
        createPeerConnection();
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        ws.send(JSON.stringify({ type: "offer", sdp: offer }));
      }
      break;

    case "peer-joined":
      setStatus("peer joined, connecting…");
      break;

    case "offer":
      createPeerConnection();
      await pc.setRemoteDescription(msg.sdp);
      await drainCandidates();
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      ws.send(JSON.stringify({ type: "answer", sdp: answer }));
      break;

    case "answer":
      await pc.setRemoteDescription(msg.sdp);
      await drainCandidates();
      break;

    case "candidate":
      if (pc?.remoteDescription) {
        await pc.addIceCandidate(msg.candidate);
      } else {
        pendingCandidates.push(msg.candidate);
      }
      break;

    case "peer-left":
      setStatus("peer left");
      remoteVideo.srcObject = null;
      remoteStream = null;
      recordBtn.disabled = true;
      if (recorder?.state === "recording") stopRecording();
      pc?.close();
      pc = null;
      break;

    case "room-full":
      setStatus("room is full (2 people max)");
      break;
  }
}

async function drainCandidates() {
  while (pendingCandidates.length) {
    await pc.addIceCandidate(pendingCandidates.shift());
  }
}

// --- recording ---

recordBtn.onclick = () => {
  if (recorder?.state === "recording") {
    stopRecording();
  } else {
    startRecording();
  }
};

function startRecording() {
  // Mix both audio streams through one AudioContext
  audioCtx = new AudioContext();
  mixedAudioDest = audioCtx.createMediaStreamDestination();
  audioCtx.createMediaStreamSource(localStream).connect(mixedAudioDest);
  if (remoteStream?.getAudioTracks().length) {
    audioCtx.createMediaStreamSource(remoteStream).connect(mixedAudioDest);
  }

  // Composite both videos side by side on the canvas
  function draw() {
    ctx2d.fillStyle = "#000";
    ctx2d.fillRect(0, 0, canvas.width, canvas.height);
    if (localVideo.readyState >= 2) {
      ctx2d.drawImage(localVideo, 0, 0, 640, 480);
    }
    if (remoteVideo.readyState >= 2) {
      ctx2d.drawImage(remoteVideo, 640, 0, 640, 480);
    }
    drawLoopId = requestAnimationFrame(draw);
  }
  draw();

  const mixed = new MediaStream([
    ...canvas.captureStream(30).getVideoTracks(),
    ...mixedAudioDest.stream.getAudioTracks(),
  ]);

  const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8,opus")
    ? "video/webm;codecs=vp8,opus"
    : "video/webm";
  recorder = new MediaRecorder(mixed, { mimeType });

  const chunks = [];
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };
  recorder.onstop = () => {
    const blob = new Blob(chunks, { type: "video/webm" });
    downloadLink.href = URL.createObjectURL(blob);
    downloadLink.download = `call-${roomId}-${Date.now()}.webm`;
    downloadLink.hidden = false;
    downloadLink.textContent =
      `Download recording (${(blob.size / 1024 / 1024).toFixed(1)} MB)`;
  };

  recorder.start(1000); // collect a chunk every second
  recordBtn.textContent = "Stop recording";
  recordBtn.classList.add("recording");
  downloadLink.hidden = true;
}

function stopRecording() {
  recorder.stop();
  cancelAnimationFrame(drawLoopId);
  audioCtx.close();
  recordBtn.textContent = "Start recording";
  recordBtn.classList.remove("recording");
}
