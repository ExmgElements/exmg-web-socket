import {PolymerElement} from '@polymer/polymer/polymer-element.js';

/**
* @namespace Exmg
*/
window.Exmg = window.Exmg || {};

/* eslint-disable */
const isJSON = (s) => {
  if ( /^\s*$/.test(s) ) { return false; }
  s = s.replace(/\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g, '@');
  s = s.replace(/"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g, ']');
  s = s.replace(/(?:^|:|,)(?:\s*\[)+/g, '');
  return (/^[\],:{}\s]*$/).test(s);
}

/* eslint-enable */
/**
 * The `exmg-web-socket` Web socket connection element including connection keep alive
 *
 * ### Keep alive
 *
 * The keep alive functionality presumes a ping to be send and a pong returned
 * including a timestamp as a value. The Format for this is for the send message is:
 *
 * ```json
 *   {"ping": 1508493238375}
 * ```
 *
 *  The server should respond:
 * ```json
 *   {"pong": 1508493238385}
 * ```
 *
 * @customElement
 * @polymer
 * @group Exmg Core Elements
 * @element exmg-web-socket
 * @demo demo/index.html
 */
class WebSocketElement extends PolymerElement {
  static get is() {
    return 'exmg-web-socket';
  }
  static get properties() {
    return {
      /**
       * Automaticly setup connection on init
       */
      auto: {
        type: Boolean,
        value: false
      },
      /*
        * Interval in which we reconnect after connection error in ms
        */
      autoReconnectInterval: {
        type: Number,
        value: 300,
      },
      /*
        * the increase rate of the reconnect interval
        */
      reconnectDecay: {
        type: Number,
        value: 1.2,
      },
      /*
        * Max value for reconnect interval in ms
        */
      maxReconnectInterval: {
        type: Number,
        value: 20000,
      },
      /**
       * By default, exmg-web-socket events do not bubble. Setting this attribute will cause its
       * events to bubble to the window object.
       */
      bubbles: {
        type: Boolean,
        value: false
      },
      /**
       * The URL to which to connect; this should be the URL to which the WebSocket server will respond.
       */
      url: {
        type: String,
        notify: true,
        observer: '_handleUrlChange'
      },
      /**
       * Either a single protocol string or an array of protocol strings. These strings are used to
       * indicate sub-protocols, so that a single server can implement multiple WebSocket sub-protocols
       * (for example, you might want one server to be able to handle different types of interactions
       * depending on the specified protocol). If you don't specify a protocol string, an empty string
       * is assumed.
       */
      protocols: {
        type: Array,
        value: []
      },
      /**
       * Specifies the format in which the data is send.
       */
      handleAs: {
        type: String,
        value: 'json'
      },
      /**
       * The most recent request made by this web-socket element.
       * @type {Object}
       */
      lastRequest: {
        type: Object,
        notify: true,
        readOnly: true
      },
      /**
       * The most recent response received by this web-socket element.
       * @type {Object}
       */
      lastResponse: {
        type: Object,
        notify: true,
        readOnly: true
      },
      /**
       * The most recent error received by this web-socket element. If any error occurred.
       * @type {Object}
       */
      lastError: {
        type: Object,
        notify: true,
        readOnly: true
      },
      /**
       * Enables verbose mode
       */
      verbose: {
        type: Boolean,
        value: false
      },

      /**
       * Sends Ping to server to keep server connection alive. Send data structur is:
       * Send: { "ping": 1506519980068 } -> Result: {"pong":1506519980088}
       */
      keepAlive: {
        type: Boolean,
        value: false
      },
      /*
        * Server Ping interval in ms
        */
      keepAliveInterval: {
        type: Number,
        value: 2500,
      },
    };
  }

  get socket() {
    return this._socket;
  }

  get readyState() {
    return this._socket && this._socket.readyState;
  }

  fire(eventName, obj) {
    if (this.verbose) {
      console.log('CustomEvent Fired', eventName, {bubbles: this.bubbles, composed: true, detail: obj});
    }
    this.dispatchEvent(new CustomEvent(eventName, {bubbles: this.bubbles, composed: true, detail: obj}));
  }

  constructor() {
    super();

    this.OPEN = 1;
    this.CLOSED = 3;

    this._reconnectAttempts = 0;
    this._lastHeartbeat = null;

    this._boundOnError = this._onError.bind(this);
    this._boundOnClose = this._onClose.bind(this);
    this._boundOnMessage = this._onMessage.bind(this);
    this._boundOnOpen = this._onOpen.bind(this);
  }

  connectedCallback() {
    super.connectedCallback();
    if (this.auto) {
      this.connect();
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._removeSocketListeners();
    this._cancelInterval();
  }

  /*
  * Method for sending messages
  */
  send(message) {
    if (!this.socket || this.readyState !== this.OPEN) {
      console.error(`Error sending message ${message} [readyState: ${this.readyState}]`);
      return;
    }

    if (this.verbose) {
      console.info(`Sending message: ${message}`);
    }
    this._socket.send(message);
  }

  /*
  * Close the current active connection with a defaul closeCode of 1000
  */
  close(closeCode = 1000) {
    if (!this.socket || this.readyState !== this.OPEN) {
      if (this.verbose) {
        console.warn(`Unable to close WebSocket connection because it is not open`);
      }
      return;
    }
    this._forceClose = true;
    this.socket.close(closeCode);
  }

  /*
  * Connect to remote server
  */
  connect() {
    if (this.socket && this.readyState !== this.CLOSED) {
      if (this.verbose) {
        console.warn(`Unable to connect becuase socket already active`);
      }
      return;
    }
    this._initializeWebSocket();
  }

  /*
  * When connected on url change close connection
  */
  _handleUrlChange() {
    if (this.socket) {
      this.close();
    }
  }

  _reconnect() {
    const timeout = Math.round(this.autoReconnectInterval * Math.pow(this.reconnectDecay, this._reconnectAttempts));
    if (this.verbose) {
      console.info(`Connection retry in ${timeout}ms`);
    }
    setTimeout(() => {
      if (this.verbose) {
        console.info('reconnecting...');
      }
      this._reconnectAttempts++;
      this.connect();
    }, Math.min(timeout, this.maxReconnectInterval));
  }

  _onError(e) {
    if (this.verbose) {
      console.error(`Connection error received`, e);
    }
    this.fire('error', e);
    this._setLastError(e);
  }

  _onClose(e) {
    if (this.verbose) {
      console.info(`Connection Closed [code: ${e.code}, forceClose: ${this._forceClose}]`);
    }
    this._cancelInterval();
    this._setLastResponse(null);
    this.fire('close');

    if (!this._forceClose) {
      this._reconnect();
    }
  }

  _cancelInterval() {
    clearInterval(this._keepAliveTimer);
    this._keepAliveTimer = null;
    this._lastHeartbeat = null;
  }

  _onMessage(e) {
    const data = e.data;
    if (this.verbose) {
      console.info(`Message received`, e.data);
    }
    if (isJSON(data) && JSON.parse(e.data).hasOwnProperty('pong')) {
      if (this.verbose) {
        console.info(`Pong received`);
      }
      this._lastHeartbeat = Date.now();
      return;
    }
    this.fire('message', e);
    this._setLastResponse(e.data);
  }

  _onOpen(e) {
    if (this.verbose) {
      console.info(`Connection open received [readyState: ${this.readyState}]`);
    }
    this._reconnectAttempts = 0;
    if (this.keepAlive) {
      this._keepAliveTimer = setInterval(this._keepAlive.bind(this), this.keepAliveInterval);
    }
    this.fire('open', {url: this.url, e: e});
  }

  _keepAlive() {
    if (!this.socket || this.readyState !== this.OPEN) {
      return;
    }
    const now = Date.now();
    if (this._lastHeartbeat && now - this._lastHeartbeat > 10000) {
      if (this.verbose) {
        console.error('Connection timout');
        this._setLastError('Connection timout');
      }
      this.socket.close();
      return;
    }
    this.send(`{"ping": ${now}}`);
  }

  _initializeWebSocket() {
    if (this.verbose) {
      console.info(`Initialize WebSocket [url: ${this.url} / protocols: ${this.protocols}]`);
    }
    if (!this.url) {
      console.error(`Please provide a valid WebSocket url ${this.url}`);
      return;
    }
    try {
      this._socket = new WebSocket(this.url, this.protocols || []);
    } catch (e) {
      if (this.verbose) {
        console.error(`Error initializing WebSocket from url ${this.url} (${e})`);
      }
      this._setLastError(e);
      this._reconnect();
    }

    this._forceClose = false;
    this._addSocketListeners();
  }

  _addSocketListeners() {
    this._socket.addEventListener('error', this._boundOnError);
    this._socket.addEventListener('close', this._boundOnClose);
    this._socket.addEventListener('message', this._boundOnMessage);
    this._socket.addEventListener('open', this._boundOnOpen);
  }

  _removeSocketListeners() {
    if (this._socket) {
      this._socket.removeEventListener('error', this._boundOnError);
      this._socket.removeEventListener('close', this._boundOnClose);
      this._socket.removeEventListener('message', this._boundOnMessage);
      this._socket.removeEventListener('open', this._boundOnOpen);
    }
  }
}

window.customElements.define(WebSocketElement.is, WebSocketElement);

Exmg.WebSocketElement = WebSocketElement;
