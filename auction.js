const Hyperswarm = require('hyperswarm');
const RPC = require('@hyperswarm/rpc');
const DHT = require('hyperdht');
const Hypercore = require('hypercore');
const Hyperbee = require('hyperbee');
const crypto = require('crypto');
const b4a = require('b4a');

const topic = crypto.createHash('sha256').update('auction-p2p').digest();

module.exports = class Auction {
  constructor() {
    this.auctions = {};  // Stores auction data
    this.bids = {};      // Stores bids
    this.hyperbee = null;
    this.peers = {};

    // For local hosted dht uncomment the following line and comment the one after
    // this.dht = new DHT({ bootstrap: [{ host: '127.0.0.1', port: 30001 }]});
    this.dht = new DHT();
    this.swarm = new Hyperswarm({ dht: this.dht });
    this.keyPair = DHT.keyPair();
    this.rpc = new RPC({ dht: this.dht, keyPair: this.keyPair });
    this.rpcServer = this.rpc.createServer();

    this.rpcServer.respond('openAuction', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const result = await this.handleOpenAuction(req);
      return Buffer.from(JSON.stringify(result), 'utf-8');
    });
    this.rpcServer.respond('placeBid', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const result = await this.handlePlaceBid(req);
      return Buffer.from(JSON.stringify(result), 'utf-8');
    });
    this.rpcServer.respond('closeAuction', async (reqRaw) => {
      const req = JSON.parse(reqRaw.toString('utf-8'));
      const result = await this.handleCloseAuction(req);
      return Buffer.from(JSON.stringify(result), 'utf-8');
    });

    this.swarm.on('connection', async (socket) => {
      const name = b4a.toString(socket.remotePublicKey, 'hex').substr(0, 6);
      console.log(`New peer found, ${name}`);

      socket.on('data', message => this.handleData({ name, message }));
      socket.on('error', e => {
        console.log(`Connection error: ${e}`);
        delete this.peers[name];
      });

      await this.handleRpcPeer(socket);
    });
  }

  async setupDatabase() {
    const hcore = new Hypercore(`./db/${this.keyPair.publicKey.toString('hex')}`, { valueEncoding: 'json' });
    this.hyperbee = new Hyperbee(hcore, { keyEncoding: 'utf-8', valueEncoding: 'json' });
    await this.hyperbee.ready();
  }

  async listen() {
    await this.rpcServer.listen(this.keyPair);
    console.log('RPC server started listening on public key:', this.keyPair.publicKey.toString('hex'));

    const discovery = this.swarm.join(topic, { server: true, client: true });
    await discovery.flushed();
  }

  async handleOpenAuction(req, broadcast = false) {
    const { auctionId, item, startingPrice } = req;
    this.auctions[auctionId] = { auctionId, item, startingPrice, highestBid: null, highestBidder: null };
    await this.hyperbee.put(`auction:${auctionId}`, this.auctions[auctionId]);
    console.log('Auction opened:', this.auctions[auctionId]);
    if (broadcast) {
      await this.broadcast('openAuction', req);
    }
    return { status: 'auction opened' };
  }

  async handlePlaceBid(req, broadcast = false) {
    const { auctionId, bidAmount, bidder } = req;
    if (this.auctions[auctionId] && (!this.auctions[auctionId].highestBid || bidAmount > this.auctions[auctionId].highestBid)) {
      this.auctions[auctionId].highestBid = bidAmount;
      this.auctions[auctionId].highestBidder = bidder;
      await this.hyperbee.put(`auction:${auctionId}`, this.auctions[auctionId]);
      console.log('Bid placed:', this.auctions[auctionId]);
      if (broadcast) {
        await this.broadcast('placeBid', req);
      }
      return { status: 'bid placed' };
    } else {
      return { status: 'bid too low or auction not found' };
    }
  }

  async handleCloseAuction(req, broadcast = false) {
    const { auctionId } = req;
    if (this.auctions[auctionId]) {
      const result = {
        auctionId,
        item: this.auctions[auctionId].item,
        highestBid: this.auctions[auctionId].highestBid,
        highestBidder: this.auctions[auctionId].highestBidder,
      };
      await this.hyperbee.put(`auction:${auctionId}`, { ...this.auctions[auctionId], closed: true });
      console.log('Auction closed:', result);
      if (broadcast) {
        await this.broadcast('closeAuction', req);
      }
      return { status: 'auction closed' };
    } else {
      return { status: 'auction not found' };
    }
  }

  async broadcast(method, payload) {
    for (const peerName in this.peers) {
      const peer = this.peers[peerName];
      try {
        const result = await this.requestPeer(peer.publicKey, method, payload);
        console.log(`Response from peer ${peerName}: ${result.status}`)
      } catch (error) {
        console.error(`Error propagating ${method} to ${peerName}:`, error);
      }
    }
  }

  async requestPeer(publicKey, method, payload) {
    const resultRaw = await this.rpc.request(publicKey, method, Buffer.from(JSON.stringify(payload), 'utf-8'));
    return JSON.parse(resultRaw.toString('utf-8'));
  }

  async handleData(data) {
    const publicKey = data.message;
    this.peers[data.name] = { publicKey };
    await this.sendOpenAuctions(data.name, publicKey);
    console.log('New peer connected');
  }

  async handleRpcPeer(socket) {
    await socket.write(this.rpcServer.publicKey)
  }

  async sendOpenAuctions(name, publicKey) {
    for (const auctionId in this.auctions) {
      const auction = this.auctions[auctionId];
      try {
        await this.requestPeer(publicKey, 'openAuction', auction);
      } catch (error) {
        console.error(`Error sending open auctions to ${name}:`, error);
      }
    }
  }
}
