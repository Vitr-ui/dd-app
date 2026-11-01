const $ = id => document.getElementById(id);
const defaults = { nickname: '', server: '', relay: false, audioProfile: 'voice', mic: '', output: '', audioBitrate: 96, channels: 1, mode: 'open', threshold: -45, echo: true, noise: true, agc: true, voiceVolume: 100, screenVolume: 100, screenProfile: 'text', resolution: 1080, fps: 30, videoBitrate: 8, customBitrate: 20, customUnit: 1000000, adaptation: 'adaptive', captureAudio: true, screenAudioBitrate: 192 };
let settings;
try { settings = { ...defaults, ...JSON.parse(localStorage.getItem('duo-settings') || '{}') }; } catch { settings = { ...defaults }; }
let ws, pc, micStream, micOutput, audioContext, analyser, gate, micSource, displayStream, myId, peerId, roomId, token;
let members = [], intentional = false, muted = false, deafened = false, speaking = false, ptt = false, testActive = false;
let reconnectTimer, iceTimer, reconnectAttempt = 0, connecting = false, connGeneration = 0;
let makingOffer = false, ignoreOffer = false, settingAnswer = false, pendingCandidates = [], signalQueue = Promise.resolve();
let rtcConfig = { iceServers: [] }, senders = {}, previousStats = new Map(), audioLoss = new Map(), adaptiveLimit = null, healthySamples = 0, statsBusy = false, applying = false;
let toastTimer, lastVoice = 0, lastState = '', parameterQueue = Promise.resolve();
let microphoneGeneration = 0;
const support = navigator.mediaDevices?.getSupportedConstraints?.() || {};
const bitrateChoices = [0, 1, 2, 4, 6, 8, 10, 12, 16, 20, 25, 30, 40, 50, 60, 80, 100].map(n => [n, n ? `${n} Mbps` : 'Automático']);
function toast(message) { $('toast').textContent = message; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 8500); }
function report(error) { const names = { NotAllowedError: 'Permissão negada ou captura cancelada. Autorize o microfone ou a tela no navegador.', NotFoundError: 'Nenhum dispositivo compatível foi encontrado.', NotReadableError: 'O dispositivo está ocupado ou não pode ser acessado.', OverconstrainedError: 'O dispositivo não aceita uma das configurações solicitadas.' }; toast(names[error?.name] || error?.message || String(error)); }
function save() { try { localStorage.setItem('duo-settings', JSON.stringify(settings)); } catch { toast('Não foi possível salvar as preferências neste navegador.'); } }
function safeSession(key, value) { try { if (value === undefined) return sessionStorage.getItem(key); if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch {} }
function send(data) { if (ws?.readyState === WebSocket.OPEN) { ws.send(JSON.stringify(data)); return true; } return false; }
function escapeURLServer(value) { if (!value.trim()) return ''; const u = new URL(value); if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw Error('Use apenas a origem HTTP/HTTPS do servidor, sem caminho, usuário ou senha.'); if (location.protocol === 'https:' && u.protocol !== 'https:') throw Error('Esta página exige um servidor HTTPS.'); return u.origin; }
function field(parent, key, label, options, hint = '') {
  const wrap = document.createElement('div'); wrap.className = 'field';
  const lab = document.createElement('label'); lab.htmlFor = `s-${key}`; lab.textContent = label;
  let el;
  if (Array.isArray(options)) { el = document.createElement('select'); for (const [v, title] of options) el.add(new Option(title, v)); }
  else { el = document.createElement('input'); el.type = options.type; for (const [k, v] of Object.entries(options)) if (k !== 'type') el.setAttribute(k, v); }
  el.id = `s-${key}`; el.dataset.setting = key;
  wrap.append(lab, el); if (hint) { const small = document.createElement('small'); small.textContent = hint; wrap.append(small); }
  $(parent).append(wrap); return el;
}
field('audio-fields', 'audioProfile', 'Perfil de áudio', [['voice', 'Voz · clareza e estabilidade'], ['music', 'Música · fidelidade'], ['custom', 'Personalizado']]);
field('audio-fields', 'audioBitrate', 'Limite de áudio', [0, 32, 48, 64, 96, 128, 160, 192, 256, 320, 510].map(n => [n, n ? `${n} kbps` : 'Automático']), 'Teto solicitado ao Opus; a taxa real depende da negociação.');
field('audio-fields', 'mic', 'Microfone', [['', 'Dispositivo padrão']]);
field('audio-fields', 'output', 'Saída de áudio', [['', 'Dispositivo padrão']]);
field('audio-advanced', 'mode', 'Transmissão', [['open', 'Microfone aberto'], ['vad', 'Ativação por voz'], ['ptt', 'Apertar para falar · Espaço']]);
field('audio-advanced', 'channels', 'Canais solicitados', [[1, 'Mono'], [2, 'Estéreo']], 'Estéreo depende da fonte e da negociação Opus.');
field('audio-advanced', 'threshold', 'Limiar de ativação (dBFS)', { type: 'range', min: -70, max: -15, step: 1 }, 'Mais perto de −70: capta sons mais baixos.');
for (const [key, label] of [['echo', 'Cancelamento de eco'], ['noise', 'Supressão de ruído'], ['agc', 'Ganho automático']]) field('audio-advanced', key, label, { type: 'checkbox' });
field('volume-fields', 'voiceVolume', 'Voz do amigo (%)', { type: 'range', min: 0, max: 100 });
field('volume-fields', 'screenVolume', 'Áudio da tela (%)', { type: 'range', min: 0, max: 100 }, 'Em zero, silencia apenas o áudio compartilhado.');
field('screen-fields', 'screenProfile', 'Perfil de compartilhamento', [['text', 'Texto e trabalho'], ['motion', 'Vídeos e jogos'], ['custom', 'Personalizado']]);
field('screen-fields', 'resolution', 'Resolução alvo', [[480, '480p'], [720, '720p'], [1080, '1080p · Full HD'], [1440, '1440p · QHD'], [2160, '2160p · 4K'], [0, 'Original']]);
field('screen-fields', 'fps', 'Quadros por segundo', [5, 10, 15, 24, 30, 60].map(n => [n, `${n} FPS`]));
field('screen-fields', 'videoBitrate', 'Limite de vídeo', [...bitrateChoices, [-1, 'Personalizado…']]);
field('screen-advanced', 'customBitrate', 'Limite personalizado', { type: 'number', min: .5, max: 100, step: 'any' });
field('screen-advanced', 'customUnit', 'Unidade', [[1000000, 'Mbps'], [1000, 'kbps']], 'Intervalo total: 500 kbps a 100 Mbps.');
field('screen-advanced', 'adaptation', 'Comportamento', [['adaptive', 'Adaptativo'], ['quality', 'Priorizar qualidade']], 'Priorizar qualidade solicita preservar resolução, reduzindo FPS quando possível.');
field('screen-advanced', 'screenAudioBitrate', 'Limite do áudio compartilhado', [0, 64, 96, 128, 192, 256, 320, 510].map(n => [n, n ? `${n} kbps` : 'Automático']));
field('screen-advanced', 'captureAudio', 'Solicitar áudio ao compartilhar', { type: 'checkbox' }, 'Alterar esta opção exige escolher a fonte novamente.');

function fillForm() {
  for (const el of document.querySelectorAll('[data-setting]')) { const value = settings[el.dataset.setting]; if (el.type === 'checkbox') el.checked = value; else el.value = String(value); }
  $('server-url').value = settings.server; $('relay-only').checked = settings.relay; updateCustom();
}
function updateCustom() {
  const enabled = $('s-videoBitrate').value === '-1'; $('s-customBitrate').disabled = !enabled; $('s-customUnit').disabled = !enabled;
  const unit = Number($('s-customUnit').value); $('s-customBitrate').min = 500000 / unit; $('s-customBitrate').max = 100000000 / unit;
}
function capabilities() {
  for (const [key, constraint] of [['echo', 'echoCancellation'], ['noise', 'noiseSuppression'], ['agc', 'autoGainControl'], ['channels', 'channelCount']]) {
    if (!support[constraint]) { const el = $(`s-${key}`); el.disabled = true; el.title = 'Este navegador não anuncia suporte a este controle.'; const note = document.createElement('small'); note.textContent = 'Controle indisponível neste navegador.'; el.parentElement.append(note); }
  }
  if (!HTMLMediaElement.prototype.setSinkId) { $('s-output').disabled = true; $('s-output').parentElement.append(Object.assign(document.createElement('small'), { textContent: 'Escolha a saída nas configurações do sistema.' })); }
  if (!navigator.mediaDevices?.getDisplayMedia) for (const id of ['share', 'share-main']) { $(id).disabled = true; $(id).title = 'Compartilhamento indisponível neste navegador ou contexto.'; }
}
async function devices() {
  if (!navigator.mediaDevices?.enumerateDevices) return;
  const all = await navigator.mediaDevices.enumerateDevices();
  for (const [key, kind] of [['mic', 'audioinput'], ['output', 'audiooutput']]) {
    const el = $(`s-${key}`), selected = el.value || settings[key]; el.replaceChildren(new Option('Dispositivo padrão', ''));
    for (const d of all.filter(d => d.kind === kind && d.deviceId)) el.add(new Option(d.label || `${kind === 'audioinput' ? 'Microfone' : 'Saída'} ${el.length}`, d.deviceId));
    if ([...el.options].some(o => o.value === selected)) el.value = selected;
  }
}
function tab(name) { for (const el of document.querySelectorAll('[data-panel]')) el.hidden = el.dataset.panel !== name; for (const el of document.querySelectorAll('[data-tab]')) { const active = el.dataset.tab === name; el.classList.toggle('selected', active); el.setAttribute('aria-selected', String(active)); } }
function openSettings(name = 'audio') { fillForm(); tab(name); $('server-url').disabled = !!roomId; $('relay-only').disabled = !!roomId; $('settings').showModal(); devices().catch(report); }
document.querySelectorAll('[data-action]').forEach(el => el.onclick = () => openSettings(el.dataset.action === 'connection' ? 'connection' : 'audio'));
document.querySelectorAll('[data-tab]').forEach(el => el.onclick = () => tab(el.dataset.tab));
$('close-settings').onclick = () => $('settings').close();
$('settings').addEventListener('close', () => { if (!roomId && !connecting) stopMic(); });
$('s-videoBitrate').onchange = updateCustom;
$('s-customUnit').onchange = () => { const unit = +$('s-customUnit').value; $('s-customBitrate').value = unit === 1000 ? Number($('s-customBitrate').value) * 1000 : Number($('s-customBitrate').value) / 1000; updateCustom(); };
$('s-audioProfile').onchange = () => {
  const music = $('s-audioProfile').value === 'music'; if ($('s-audioProfile').value === 'custom') return;
  for (const key of ['echo', 'noise', 'agc']) $(`s-${key}`).checked = !music;
  $('s-channels').value = music ? '2' : '1'; $('s-audioBitrate').value = music ? '256' : '96';
};
$('s-screenProfile').onchange = () => { const value = $('s-screenProfile').value; if (value === 'custom') return; $('s-fps').value = value === 'motion' ? '60' : '15'; $('s-videoBitrate').value = value === 'motion' ? '16' : '8'; updateCustom(); };
for (const key of ['voiceVolume', 'screenVolume', 'threshold']) $(`s-${key}`).oninput = e => { settings[key] = +e.target.value; e.target.title = `${e.target.value}${key === 'threshold' ? ' dBFS' : '%'}`; volumes(); };
function readForm() {
  const next = { ...settings };
  for (const el of document.querySelectorAll('[data-setting]')) { if (el.disabled) continue; const key = el.dataset.setting; next[key] = el.type === 'checkbox' ? el.checked : typeof defaults[key] === 'number' ? Number(el.value) : el.value; }
  if (!roomId) { next.server = escapeURLServer($('server-url').value); next.relay = $('relay-only').checked; }
  const bps = next.customBitrate * next.customUnit;
  if (next.videoBitrate === -1 && (!Number.isFinite(bps) || bps < 500000 || bps > 100000000)) throw Error('Escolha um limite entre 500 kbps e 100 Mbps.');
  return next;
}
function videoCap() { return settings.videoBitrate === -1 ? settings.customBitrate * settings.customUnit : settings.videoBitrate * 1000000; }
function volumes() { $('remote-voice').volume = settings.voiceVolume / 100; $('remote-screen-audio').volume = settings.screenVolume / 100; $('remote-voice').muted = $('remote-screen-audio').muted = deafened; }
async function outputDevice() { if (!HTMLMediaElement.prototype.setSinkId) return; await Promise.all([$ ('remote-voice').setSinkId(settings.output), $('remote-screen-audio').setSinkId(settings.output)]); }
function captureConstraints() {
  const c = {}; if (settings.mic) c.deviceId = { exact: settings.mic };
  for (const [key, name] of [['echo', 'echoCancellation'], ['noise', 'noiseSuppression'], ['agc', 'autoGainControl']]) if (support[name]) c[name] = { ideal: settings[key] };
  if (support.channelCount) c.channelCount = { ideal: settings.channels };
  return c;
}
async function acquireMic() {
  if (!navigator.mediaDevices?.getUserMedia) throw Error('Microfone indisponível. Abra por HTTPS ou localhost em um navegador compatível.');
  const generation = ++microphoneGeneration;
  let timer;
  const pending = navigator.mediaDevices.getUserMedia({ audio: captureConstraints(), video: false }).then(stream => {
    if (generation !== microphoneGeneration) { stream.getTracks().forEach(t => t.stop()); throw Error('Solicitação de microfone cancelada.'); }
    return stream;
  });
  const stream = await Promise.race([pending, new Promise((_, reject) => { timer = setTimeout(() => { if (generation === microphoneGeneration) microphoneGeneration++; reject(Error('O navegador não respondeu à solicitação de microfone. Confira a permissão e tente novamente.')); }, 20000); })]).finally(() => clearTimeout(timer));
  try {
    audioContext ||= new AudioContext(); await audioContext.resume();
    const source = audioContext.createMediaStreamSource(stream), meter = audioContext.createAnalyser(), gain = audioContext.createGain(), destination = audioContext.createMediaStreamDestination();
    meter.fftSize = 1024; destination.channelCount = settings.channels; gain.channelCount = settings.channels; gain.channelCountMode = 'explicit';
    source.connect(meter); meter.connect(gain); gain.connect(destination);
    const out = destination.stream; out.getAudioTracks()[0].contentHint = settings.audioProfile === 'music' ? 'music' : 'speech';
    if (senders.voice) await senders.voice.replaceTrack(out.getAudioTracks()[0]);
    micStream?.getTracks().forEach(t => t.stop()); micOutput?.getTracks().forEach(t => t.stop()); micSource?.disconnect(); analyser?.disconnect(); gate?.disconnect();
    micStream = stream; micOutput = out; micSource = source; analyser = meter; gate = gain;
    stream.getAudioTracks()[0].onended = () => { muted = true; updateMicGate(false); toast('O microfone foi desconectado. Escolha outro nas configurações.'); };
    await devices(); updateMicGate(false);
  } catch (e) { stream.getTracks().forEach(t => t.stop()); throw e; }
}
function stopMic() {
  microphoneGeneration++;
  micStream?.getTracks().forEach(t => t.stop()); micOutput?.getTracks().forEach(t => t.stop()); micSource?.disconnect(); analyser?.disconnect(); gate?.disconnect();
  micStream = micOutput = micSource = analyser = gate = null; testActive = false;
  audioContext?.close().catch(() => {}); audioContext = null; $('test-mic').textContent = 'Testar microfone'; $('mic-meter').value = 0; $('test-level').textContent = 'Sem captura';
}
function updateMicGate(detected) {
  const transmit = !muted && (settings.mode === 'open' || settings.mode === 'ptt' && ptt || settings.mode === 'vad' && detected);
  if (gate) gate.gain.value = transmit ? 1 : 0;
  speaking = transmit && detected;
  $('mute').classList.toggle('active', muted); $('mute').setAttribute('aria-pressed', String(muted));
  $('mic-state').textContent = muted ? 'Microfone silenciado' : settings.mode === 'ptt' ? (ptt ? 'Transmitindo' : 'Segure Espaço para falar') : 'Microfone ativo';
  const state = JSON.stringify({ type: 'state', muted: muted || settings.mode === 'ptt' && !ptt, speaking, sharing: !!displayStream });
  if (state !== lastState && roomId && send(JSON.parse(state))) lastState = state;
}
setInterval(() => {
  if (!analyser) return;
  const data = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(data);
  const rms = Math.sqrt(data.reduce((sum, n) => sum + n * n, 0) / data.length), db = 20 * Math.log10(Math.max(rms, 1e-8));
  if (db > settings.threshold) lastVoice = Date.now();
  $('mic-meter').value = Math.min(1, rms * 4); $('test-level').textContent = `${Math.round(db)} dBFS`;
  updateMicGate(Date.now() - lastVoice < 220);
}, 100);
async function testMic() { if (testActive && !roomId) { stopMic(); return; } if (!micStream) { settings = readForm(); await acquireMic(); } testActive = true; $('test-mic').textContent = roomId ? 'Microfone em uso na chamada' : 'Parar teste'; }
$('test-mic').onclick = () => testMic().catch(report);
$('home-test').onclick = () => { openSettings(); testMic().catch(report); };
function setStatus(text) { $('connection-status').textContent = text; }
function renderMembers() {
  const root = $('participants'); root.replaceChildren(); $('room-count').textContent = `${members.length} / 2`;
  for (const m of members) {
    const box = document.createElement('div'); box.className = `participant${m.state?.speaking ? ' speaking' : ''}`;
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = m.name.slice(0, 1).toUpperCase();
    const info = document.createElement('div'), name = document.createElement('span'), status = document.createElement('small');
    name.textContent = `${m.name}${m.id === myId ? ' · você' : ''}`;
    status.textContent = !m.online ? 'Reconectando…' : m.state?.muted ? 'Microfone silenciado' : m.state?.speaking ? 'Falando agora' : 'Na sala'; info.append(name, status); box.append(avatar, info); root.append(box);
  }
  if (members.length === 1) { const placeholder = document.createElement('div'); placeholder.className = 'participant'; placeholder.textContent = '+ Aguardando seu amigo'; root.append(placeholder); }
}
function parseRoom(value) { let result = value.trim(); if (result.includes('://')) { const u = new URL(result); result = new URLSearchParams(u.hash.slice(1)).get('sala') || ''; } if (!/^[A-Za-z0-9_-]{32}$/.test(result)) throw Error('Cole um convite válido ou o código completo da sala.'); return result; }
async function enter(create) {
  if (connecting || roomId) return;
  const name = $('nickname').value.trim(); if (!name) { $('nickname').focus(); throw Error('Digite seu apelido para entrar.'); }
  const target = create ? null : parseRoom($('roomcode').value);
  connecting = true; intentional = false; $('create').disabled = $('join').disabled = true;
  try { settings.nickname = name; save(); muted = false; await acquireMic(); await outputDevice(); connectSocket(create, target); }
  catch (e) { connecting = false; $('create').disabled = $('join').disabled = false; stopMic(); throw e; }
}
function connectSocket(create, target) {
  let origin;
  try { origin = new URL(settings.server || location.origin); } catch { throw Error('Configure um endereço de servidor válido.'); }
  origin.protocol = origin.protocol === 'https:' ? 'wss:' : 'ws:'; origin.pathname = '/signal'; origin.hash = ''; origin.search = '';
  const socket = new WebSocket(origin); ws = socket;
  const timeout = setTimeout(() => { if (socket.readyState !== WebSocket.OPEN) { socket.close(); toast('Não foi possível alcançar o servidor. Confira o endereço em Conexão.'); } }, 10000);
  socket.onopen = () => { clearTimeout(timeout); socket.send(JSON.stringify({ type: create ? 'create' : 'join', name: settings.nickname, room: target, token: safeSession(`duo-token-${target}`) || token })); };
  socket.onerror = () => { if (!roomId) toast('Servidor indisponível. Inicie o backend ou configure o endereço em Conexão.'); };
  socket.onmessage = e => {
    let msg; try { msg = JSON.parse(e.data); } catch { return; }
    if (socket !== ws) return;
    if (msg.type === 'error') { report(new Error(msg.message)); if (connecting) leave(false); return; }
    if (msg.type === 'joined') {
      roomId = msg.room; myId = msg.id; token = msg.token; safeSession(`duo-token-${roomId}`, token);
      rtcConfig = { iceServers: msg.iceServers, iceTransportPolicy: settings.relay ? 'relay' : 'all' };
      if (settings.relay && !msg.turnConfigured) { toast('O modo somente TURN precisa de um servidor TURN configurado. Desative-o para tentar conexão direta.'); leave(false); return; }
      $('turn-status').textContent = msg.turnConfigured ? 'TURN configurado. Credenciais temporárias recebidas do servidor.' : 'Sem TURN configurado. Conexões entre algumas redes poderão falhar.';
      connecting = false; reconnectAttempt = 0; clearTimeout(reconnectTimer); lastState = '';
      $('home').hidden = true; $('room').hidden = false; $('call-name').textContent = settings.nickname;
      history.replaceState(null, '', `#sala=${roomId}`); setStatus('Aguardando amigo');
      clearInterval(iceTimer); iceTimer = setInterval(() => send({ type: 'ice-config' }), Math.max(30000, Math.min(600000, msg.ttl * 500)));
      return;
    }
    if (msg.type === 'ice-config') { rtcConfig.iceServers = msg.iceServers; try { pc?.setConfiguration(rtcConfig); } catch (e) { report(e); } return; }
    if (msg.type === 'roster') {
      members = msg.peers; renderMembers();
      const other = members.find(m => m.id !== myId && m.online);
      if (!other) { destroyPeer(); setStatus(members.length > 1 ? 'Amigo reconectando…' : 'Aguardando amigo'); }
      else if (other.id !== peerId || !pc) { createPeer(other.id).catch(report); }
      updateStage(); return;
    }
    if (msg.type === 'signal') { signalQueue = signalQueue.then(() => receiveSignal(msg)).catch(report); return; }
    if (msg.type === 'chat') addMessage(msg);
  };
  socket.onclose = e => {
    clearTimeout(timeout); if (socket !== ws) return;
    if (intentional) return;
    if (e.code === 4000) { toast('Esta sessão foi retomada em outra conexão.'); leave(false); return; }
    if (!roomId) { connecting = false; $('create').disabled = $('join').disabled = false; stopMic(); return; }
    destroyPeer(); setStatus('Reconectando…'); connecting = true;
    reconnectTimer = setTimeout(() => connectSocket(false, roomId), Math.min(5000, 500 * 2 ** reconnectAttempt++));
  };
}
function destroyPeer() {
  connGeneration++; pc?.close(); pc = null; peerId = null; senders = {}; pendingCandidates = []; makingOffer = false; ignoreOffer = false; settingAnswer = false; previousStats.clear(); audioLoss.clear(); adaptiveLimit = null;
  for (const id of ['remote-video', 'remote-voice', 'remote-screen-audio']) $(id).srcObject = null;
  updateStage();
}
function stereoSDP(description) {
  const sdp = description.sdp;
  const opus = [...sdp.matchAll(/a=rtpmap:(\d+) opus\/48000\/2/g)].map(m => m[1]);
  let result = sdp;
  for (const pt of new Set(opus)) result = result.replace(new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`, 'g'), (_, params) => {
    const rest = params.split(';').filter(p => !/^\s*(stereo|sprop-stereo)=/.test(p));
    return `a=fmtp:${pt} ${rest.join(';')};stereo=1;sprop-stereo=1`;
  });
  return { type: description.type, sdp: result };
}
async function localDescription(connection) {
  const d = connection.signalingState === 'have-remote-offer' ? await connection.createAnswer() : await connection.createOffer();
  await connection.setLocalDescription(stereoSDP(d));
}
async function createPeer(otherId) {
  destroyPeer(); peerId = otherId; const connection = new RTCPeerConnection(rtcConfig); pc = connection;
  const tracks = [micOutput?.getAudioTracks()[0], displayStream?.getAudioTracks()[0], displayStream?.getVideoTracks()[0]];
  ['voice', 'screenAudio', 'video'].forEach((kind, i) => {
    const transceiver = connection.addTransceiver(tracks[i] || (i === 2 ? 'video' : 'audio'), { direction: 'sendrecv', streams: [i === 0 ? micOutput : displayStream].filter(Boolean) });
    senders[kind] = transceiver.sender;
    if (i < 2 && transceiver.setCodecPreferences && RTCRtpReceiver.getCapabilities) {
      const codecs = RTCRtpReceiver.getCapabilities('audio')?.codecs || [], opus = codecs.filter(c => c.mimeType.toLowerCase() === 'audio/opus');
      if (opus.length) transceiver.setCodecPreferences(opus);
    }
  });
  connection.onicecandidate = e => { if (pc === connection) send({ type: 'signal', data: { candidate: e.candidate?.toJSON() || null } }); };
  connection.ontrack = e => {
    if (pc !== connection) return;
    const i = connection.getTransceivers().indexOf(e.transceiver), element = i === 0 ? $('remote-voice') : i === 1 ? $('remote-screen-audio') : $('remote-video');
    element.srcObject = new MediaStream([e.track]); e.track.onunmute = updateStage; e.track.onmute = updateStage; e.track.onended = updateStage;
    element.play().catch(() => { if (i < 2) $('unlock-audio').hidden = false; }); volumes(); updateStage();
  };
  connection.onconnectionstatechange = () => {
    if (pc !== connection) return;
    const names = { new: 'Conectando…', connecting: 'Conectando…', connected: 'Conectados', disconnected: 'Reconectando mídia…', failed: 'Falha de conexão · verifique TURN', closed: 'Desconectado' };
    setStatus(names[connection.connectionState]); if (connection.connectionState === 'connected') applySendParameters().catch(report);
    if (connection.connectionState === 'failed') { connection.restartIce(); negotiate(connection).catch(report); }
  };
  if (myId < otherId) await negotiate(connection);
}
async function negotiate(connection) {
  if (connection !== pc || makingOffer || connection.signalingState !== 'stable') return;
  try { makingOffer = true; await localDescription(connection); if (connection === pc) send({ type: 'signal', data: { description: connection.localDescription } }); }
  finally { makingOffer = false; }
}
async function receiveSignal(msg) {
  if (msg.from !== peerId || !pc) return;
  const connection = pc, data = msg.data;
  if (data.description) {
    const d = data.description, ready = !makingOffer && (connection.signalingState === 'stable' || settingAnswer);
    const collision = d.type === 'offer' && !ready;
    ignoreOffer = myId < peerId && collision; if (ignoreOffer) return;
    settingAnswer = d.type === 'answer';
    try { await connection.setRemoteDescription(d); } finally { settingAnswer = false; }
    if (connection !== pc) return;
    for (const candidate of pendingCandidates.splice(0)) await connection.addIceCandidate(candidate);
    if (d.type === 'offer') { await localDescription(connection); send({ type: 'signal', data: { description: connection.localDescription } }); }
    await applySendParameters();
  } else if ('candidate' in data && !ignoreOffer) {
    if (!connection.remoteDescription) pendingCandidates.push(data.candidate); else await connection.addIceCandidate(data.candidate);
  }
}
function applySendParameters() {
  const connection = pc;
  const task = async () => {
    if (!connection || pc !== connection || connection.signalingState !== 'stable' || !connection.remoteDescription) return;
    for (const [kind, sender] of Object.entries(senders)) {
      if (!sender.track || pc !== connection) continue;
      const p = sender.getParameters(); if (!p.encodings?.length) continue;
      const cap = kind === 'video' ? adaptiveLimit || videoCap() : (kind === 'voice' ? settings.audioBitrate : settings.screenAudioBitrate) * 1000;
      for (const encoding of p.encodings) {
        if (cap) encoding.maxBitrate = cap; else delete encoding.maxBitrate;
        encoding.priority = kind === 'voice' ? 'high' : 'low'; encoding.networkPriority = kind === 'voice' ? 'high' : 'low';
        if (kind === 'video') encoding.maxFramerate = settings.fps;
      }
      if (kind === 'video') p.degradationPreference = settings.adaptation === 'quality' ? 'maintain-resolution' : 'balanced';
      await sender.setParameters(p);
    }
  };
  parameterQueue = parameterQueue.catch(() => {}).then(task); return parameterQueue;
}
async function applyDisplayConstraints() {
  const track = displayStream?.getVideoTracks()[0]; if (!track) return;
  track.contentHint = settings.screenProfile === 'motion' ? 'motion' : 'detail';
  const c = { frameRate: { ideal: settings.fps, max: settings.fps } };
  if (settings.resolution) c.height = { ideal: settings.resolution, max: settings.resolution };
  await track.applyConstraints(c);
}
async function share(replace = false) {
  if (!roomId) throw Error('Entre em uma sala antes de compartilhar.');
  if (displayStream && !replace) { await stopShare(); return; }
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { ideal: settings.fps }, ...(settings.resolution ? { height: { ideal: settings.resolution } } : {}) }, audio: settings.captureAudio ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 } : false });
  if (!roomId) { stream.getTracks().forEach(t => t.stop()); return; }
  const old = displayStream;
  try {
    displayStream = stream; await applyDisplayConstraints();
    await senders.video?.replaceTrack(stream.getVideoTracks()[0]);
    await senders.screenAudio?.replaceTrack(stream.getAudioTracks()[0] || null);
    $('local-preview').srcObject = stream;
    stream.getVideoTracks()[0].onended = () => { if (displayStream === stream) stopShare().catch(report); };
    adaptiveLimit = null; await applySendParameters(); old?.getTracks().forEach(t => t.stop()); updateStage(); updateMicGate(false);
    if (settings.captureAudio && !stream.getAudioTracks().length) toast('Tela compartilhada sem áudio: a fonte ou o navegador não forneceu uma faixa de áudio.');
  } catch (e) {
    stream.getTracks().forEach(t => t.stop()); displayStream = old; $('local-preview').srcObject = old;
    await senders.video?.replaceTrack(old?.getVideoTracks()[0] || null).catch(() => {});
    await senders.screenAudio?.replaceTrack(old?.getAudioTracks()[0] || null).catch(() => {}); throw e;
  }
}
async function stopShare() {
  const old = displayStream; displayStream = null; old?.getTracks().forEach(t => t.stop()); $('local-preview').srcObject = null;
  await Promise.all([senders.video?.replaceTrack(null), senders.screenAudio?.replaceTrack(null)]); adaptiveLimit = null; updateStage(); updateMicGate(false);
}
function updateStage() {
  const other = members.find(m => m.id === peerId), remoteTrack = $('remote-video').srcObject?.getVideoTracks()[0];
  const remote = !!(other?.state?.sharing && remoteTrack && !remoteTrack.muted && remoteTrack.readyState === 'live');
  $('remote-video').hidden = !remote; $('local-preview').hidden = !displayStream; $('local-preview').classList.toggle('preview-corner', remote);
  $('empty-screen').hidden = remote || !!displayStream; $('screen-toolbar').hidden = !remote && !displayStream;
  $('screen-label').textContent = remote ? `Tela de ${other.name}` : 'Você está compartilhando sua tela';
  $('share').classList.toggle('active', !!displayStream); $('share').querySelector('span').textContent = displayStream ? 'Parar tela' : 'Compartilhar'; $('replace-share').hidden = !displayStream;
  $('quality-label').textContent = `Alvo: ${settings.resolution ? settings.resolution + 'p' : 'original'} · ${settings.fps} FPS · ${videoCap() ? formatRate(videoCap()) + ' de limite' : 'taxa automática'}`;
}
function addMessage(msg) {
  const root = $('messages'); root.querySelector('.chat-start')?.remove(); const div = document.createElement('div'); div.className = 'message';
  const name = document.createElement('strong'), time = document.createElement('time'), p = document.createElement('p'); name.textContent = msg.name; time.textContent = new Date(msg.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); p.textContent = msg.text; div.append(name, time, p); root.append(div);
  while (root.children.length > 300) root.firstElementChild.remove(); root.scrollTop = root.scrollHeight;
}
async function applySettings() {
  if (applying) return; applying = true;
  try {
    const old = settings, next = readForm(); settings = next;
    try {
      if (micStream && ['mic', 'channels', 'echo', 'noise', 'agc', 'audioProfile'].some(k => old[k] !== next[k])) await acquireMic();
      await outputDevice(); await applyDisplayConstraints(); adaptiveLimit = null; await applySendParameters(); volumes(); save(); updateStage();
      const actual = micStream?.getAudioTracks()[0]?.getSettings();
      $('applied').textContent = `Preferências salvas. ${pc ? 'Parâmetros enviados ao WebRTC; confira a taxa real no diagnóstico.' : 'Os limites de transmissão serão aplicados na conexão.'}${actual ? `\nCaptura do microfone: ${actual.channelCount ?? 'Indisponível'} canal(is), ${actual.sampleRate ?? 'Indisponível'} Hz. Eco: ${actual.echoCancellation ?? 'Indisponível'}. Ruído: ${actual.noiseSuppression ?? 'Indisponível'}. Ganho: ${actual.autoGainControl ?? 'Indisponível'}.` : ''}${old.captureAudio !== next.captureAudio && displayStream ? '\nEscolha “Trocar fonte” para aplicar a mudança de captura de áudio.' : ''}`;
    } catch (e) { $('applied').textContent = 'Nem todos os ajustes foram aplicados. Confira o diagnóstico e tente novamente: ' + e.message; throw e; }
  } finally { applying = false; }
}
$('settings-form').onsubmit = e => { e.preventDefault(); applySettings().catch(report); };
$('reset').onclick = () => { const current = settings; settings = { ...defaults, nickname: current.nickname, server: current.server, relay: current.relay }; fillForm(); settings = current; $('applied').textContent = 'Padrões carregados. Clique em Salvar e aplicar para confirmar.'; };
function formatRate(n) { return n >= 1000000 ? `${(n / 1000000).toFixed(2)} Mbps` : `${Math.round(n / 1000)} kbps`; }
const metric = (n, suffix = '', digits = 1) => Number.isFinite(n) ? `${n.toFixed(digits)}${suffix}` : 'Indisponível';
async function sampleStats() {
  if (!pc || statsBusy) return; statsBusy = true; const connection = pc;
  try {
    const stats = await connection.getStats(); if (connection !== pc) return;
    const lines = [], requestedCap = videoCap(); let rtt, audioCongested = false, measuredVideo = 0;
    lines.push(`SOLICITADO  vídeo ${requestedCap ? formatRate(requestedCap) : 'Automático'} | ${settings.resolution || 'Original'}p | ${settings.fps} FPS`, `SOLICITADO  voz ${settings.audioBitrate ? settings.audioBitrate + ' kbps' : 'Automático'} | ${settings.channels} canal(is)`);
    for (const [kind, sender] of Object.entries(senders)) if (sender.track) { const p = sender.getParameters(), e = p.encodings?.[0]; lines.push(`APLICADO ${kind}: teto ${e?.maxBitrate ? formatRate(e.maxBitrate) : 'não informado / automático'} | prioridade ${e?.priority || 'Indisponível'}${kind === 'video' ? ' | adaptação ' + (p.degradationPreference || 'Indisponível') : ''}`); }
    const capture = displayStream?.getVideoTracks()[0]?.getSettings(); if (capture) lines.push(`CAPTURA tela: ${capture.width ?? '?'} × ${capture.height ?? '?'} | ${metric(capture.frameRate, ' FPS')}`);
    stats.forEach(s => {
      if (s.type === 'transport' && s.selectedCandidatePairId) { const pair = stats.get(s.selectedCandidatePairId), local = stats.get(pair?.localCandidateId), remote = stats.get(pair?.remoteCandidateId); rtt = pair?.currentRoundTripTime; lines.push(`REDE: ${local && remote ? local.candidateType === 'relay' || remote.candidateType === 'relay' ? 'TURN' : 'Direta' : 'Indisponível'} | RTT ${metric(rtt * 1000, ' ms')}`); }
      if (s.type === 'remote-inbound-rtp' && s.kind === 'audio') {
        const prev = audioLoss.get(s.id); const lost = prev ? Math.max(0, s.packetsLost - prev.lost) : 0; const received = prev ? Math.max(0, (s.packetsReceived ?? 0) - prev.received) : 0;
        if ((s.fractionLost ?? (received + lost ? lost / (received + lost) : 0)) > .03 || s.roundTripTime > .35 || s.jitter > .05) audioCongested = true;
        audioLoss.set(s.id, { lost: s.packetsLost || 0, received: s.packetsReceived || 0 });
        lines.push(`VOZ no destino: perda acumulada ${metric(s.packetsLost, ' pacotes', 0)} | jitter ${metric(s.jitter * 1000, ' ms')} | RTT ${metric(s.roundTripTime * 1000, ' ms')}`);
      }
      if (!['inbound-rtp', 'outbound-rtp'].includes(s.type) || s.isRemote) return;
      const outbound = s.type === 'outbound-rtp', bytes = outbound ? s.bytesSent : s.bytesReceived, prev = previousStats.get(s.id);
      const bps = prev && s.timestamp > prev.time ? Math.max(0, (bytes - prev.bytes) * 8000 / (s.timestamp - prev.time)) : null;
      previousStats.set(s.id, { bytes, time: s.timestamp }); const codec = stats.get(s.codecId)?.mimeType || 'Indisponível';
      if (s.kind === 'video' && outbound && bps) measuredVideo += bps;
      lines.push(`${outbound ? 'ENVIO' : 'RECEBIMENTO'} ${s.kind}: ${bps === null ? 'medindo…' : formatRate(bps)} | ${codec}`);
      if (s.kind === 'video') lines.push(`  ${s.frameWidth && s.frameHeight ? s.frameWidth + ' × ' + s.frameHeight : 'Resolução indisponível'} | ${metric(s.framesPerSecond, ' FPS')} | limitação ${s.qualityLimitationReason || 'Indisponível'}`);
      if (!outbound) lines.push(`  perda acumulada ${metric(s.packetsLost, ' pacotes', 0)} | jitter ${metric(s.jitter * 1000, ' ms')}`);
    });
    if (displayStream && (audioCongested || rtt > .35)) {
      healthySamples = 0; const base = adaptiveLimit || measuredVideo || requestedCap || 8000000;
      adaptiveLimit = Math.round(Math.max(250000, Math.min(requestedCap || 100000000, base * .7))); await applySendParameters();
    } else if (adaptiveLimit && ++healthySamples >= 5) {
      healthySamples = 0; const ceiling = requestedCap || 20000000; adaptiveLimit = Math.min(ceiling, Math.round(adaptiveLimit * 1.2)); if (adaptiveLimit >= ceiling) adaptiveLimit = null; await applySendParameters();
    }
    lines.push(adaptiveLimit ? `PROTEÇÃO DE VOZ: vídeo limitado temporariamente a ${formatRate(adaptiveLimit)}.` : 'PROTEÇÃO DE VOZ: prioridade alta solicitada; monitoramento de perda e atraso ativo.');
    $('stats').textContent = lines.join('\n');
  } catch (e) { if (connection === pc) $('stats').textContent = 'Não foi possível atualizar o diagnóstico: ' + e.message; }
  finally { statsBusy = false; }
}
setInterval(sampleStats, 2000);
function leave(clearHash = true) {
  intentional = true; connecting = false; clearTimeout(reconnectTimer); clearInterval(iceTimer);
  send({ type: 'leave' }); ws?.close(); ws = null;
  if (roomId) safeSession(`duo-token-${roomId}`, null); roomId = myId = token = null; members = [];
  destroyPeer(); displayStream?.getTracks().forEach(t => t.stop()); displayStream = null; $('local-preview').srcObject = null; stopMic();
  $('home').hidden = false; $('room').hidden = true; $('unlock-audio').hidden = true; $('create').disabled = $('join').disabled = false; $('messages').replaceChildren(); $('stats').textContent = 'Aguardando conexão.';
  if (clearHash) history.replaceState(null, '', location.pathname); updateStage();
}
$('create').onclick = () => enter(true).catch(report); $('join').onclick = () => enter(false).catch(report);
$('mute').onclick = () => { muted = !muted; updateMicGate(false); };
$('deafen').onclick = () => { deafened = !deafened; volumes(); $('deafen').classList.toggle('active', deafened); $('deafen').setAttribute('aria-pressed', String(deafened)); };
for (const id of ['share', 'share-main']) $(id).onclick = () => share().catch(report);
$('replace-share').onclick = () => share(true).catch(report);
$('leave').onclick = () => leave();
$('invite').onclick = async () => { try { await navigator.clipboard.writeText(`${location.origin}${location.pathname}#sala=${roomId}`); toast('Convite copiado. Envie para seu amigo.'); } catch { toast(`Código da sala: ${roomId}`); } };
$('fullscreen').onclick = () => { if (document.fullscreenElement) document.exitFullscreen().catch(report); else $('screen-stage').requestFullscreen().catch(report); };
$('fit').onclick = () => { const original = $('screen-stage').classList.toggle('original'); $('fit').textContent = original ? 'Ajustar à janela' : 'Tamanho original'; };
$('chat-toggle').onclick = () => { $('chat-panel').hidden = !$('chat-panel').hidden; document.querySelector('.room-layout').classList.toggle('no-chat', $('chat-panel').hidden); };
$('diagnostic-toggle').onclick = () => { $('diagnostics').hidden = !$('diagnostics').hidden; sampleStats(); };
$('chat-form').onsubmit = e => { e.preventDefault(); const text = $('chat-input').value.trim(); if (text && send({ type: 'chat', text })) $('chat-input').value = ''; else if (text) toast('Aguarde a reconexão para enviar sua mensagem.'); };
$('unlock-audio').onclick = async () => { try { await audioContext?.resume(); await Promise.all(['remote-voice', 'remote-screen-audio'].filter(id => $(id).srcObject).map(id => $(id).play())); $('unlock-audio').hidden = true; } catch (e) { report(e); } };
document.addEventListener('keydown', e => { if (settings.mode === 'ptt' && roomId && e.code === 'Space' && !['INPUT', 'TEXTAREA', 'SELECT', 'BUTTON'].includes(e.target.tagName)) { e.preventDefault(); ptt = true; updateMicGate(false); } });
document.addEventListener('keyup', e => { if (e.code === 'Space') { ptt = false; updateMicGate(false); } });
window.addEventListener('blur', () => { ptt = false; updateMicGate(false); });
window.addEventListener('pagehide', () => leave(false));
navigator.mediaDevices?.addEventListener('devicechange', () => devices().catch(report));
const incoming = new URLSearchParams(location.hash.slice(1)).get('sala'); if (incoming) $('roomcode').value = incoming;
$('nickname').value = settings.nickname; fillForm(); capabilities(); volumes(); updateStage();
$('server-notice').hidden = !!settings.server || ['localhost', '127.0.0.1'].includes(location.hostname);
if (!settings.server && !$('server-notice').hidden) fetch('/health').then(r => r.ok ? r.json() : null).then(data => { if (data?.ok === true) $('server-notice').hidden = true; }).catch(() => {});
