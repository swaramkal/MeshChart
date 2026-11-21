const SERVICE_UUID='6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const RX_UUID='6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const TX_UUID='6e400003-b5a3-f393-e0a9-e50e24dcca9e';

export class BluetoothAdapter {
  constructor() { this.peers=new Map(); this.listeners=new Set(); this.device=null; this.server=null; this.characteristic=null; }
  onPeer(callback) { this.listeners.add(callback); return ()=>this.listeners.delete(callback); }
  getPeers() { return [...this.peers.values()]; }
  emit(peer) { for(const callback of this.listeners) callback(peer); }
  async startScan() {
    const native=globalThis.Capacitor?.Plugins?.MeshBle;
    if (native?.startScan) {
      await native.startScan({serviceUuid:SERVICE_UUID});
      return;
    }
    if (!navigator.bluetooth?.requestDevice) throw new Error('Bluetooth LE scanning is not supported here. Use the Android build with native BLE support.');
    const device=await navigator.bluetooth.requestDevice({filters:[{services:[SERVICE_UUID]}],optionalServices:[SERVICE_UUID]});
    this.device=device;
    this.addPeer({id:device.id,name:device.name||'MeshChat device'});
    device.addEventListener('gattserverdisconnected',()=>{this.server=null;this.characteristic=null;});
  }
  async connect(deviceId) {
    const peer=this.peers.get(deviceId);
    if (!peer?.device) throw new Error('Select a Bluetooth device discovered in this session.');
    this.server=await peer.device.gatt.connect();
    const service=await this.server.getPrimaryService(SERVICE_UUID);
    this.characteristic=await service.getCharacteristic(TX_UUID);
    await this.characteristic.startNotifications();
    this.characteristic.addEventListener('characteristicvaluechanged',event=>{
      const bytes=new Uint8Array(event.target.value.buffer);
      this.emitMessage(new TextDecoder().decode(bytes),deviceId);
    });
    return true;
  }
  addPeer(peer) { this.peers.set(peer.id,{...peer,seenAt:Date.now()}); this.emit(peer); }
  emitMessage(data,peerId) { this.onMessage?.({data,peerId}); }
  onMessage(callback) { this.messageHandler=callback; }
  async send(data) {
    if (!this.characteristic) throw new Error('No connected Bluetooth GATT characteristic.');
    const service=this.characteristic.service;
    const rx=await service.getCharacteristic(RX_UUID);
    const bytes=new TextEncoder().encode(data);
    if (bytes.length>20) throw new Error('This transport adapter does not fragment packets yet; payload exceeds the default BLE limit.');
    await rx.writeValueWithResponse(bytes);
  }
  async stopScan() {
    const native=globalThis.Capacitor?.Plugins?.MeshBle;
    if (native?.stopScan) await native.stopScan();
  }
}
