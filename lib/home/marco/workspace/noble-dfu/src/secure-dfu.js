"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});
exports.SecureDFU = exports.STATES = undefined;

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

var _events = require("events");

var _events2 = _interopRequireDefault(_events);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

require("babel-polyfill");

var SERVICE_UUID = "fe59";
var CONTROL_UUID = "8ec90001-f315-4f60-9fb8-838830daea50";
var PACKET_UUID = "8ec90002-f315-4f60-9fb8-838830daea50";
var BUTTON_UUID = "8ec90003-f315-4f60-9fb8-838830daea50";

var LITTLE_ENDIAN = true;
var PACKET_SIZE = 20;

var OPERATIONS = {
  BUTTON_COMMAND: [0x01],
  CREATE_COMMAND: [0x01, 0x01],
  CREATE_DATA: [0x01, 0x02],
  RECEIPT_NOTIFICATIONS: [0x02],
  CALCULATE_CHECKSUM: [0x03],
  EXECUTE: [0x04],
  SELECT_COMMAND: [0x06, 0x01],
  SELECT_DATA: [0x06, 0x02],
  RESPONSE: [0x60, 0x20]
};

var RESPONSE = {
  0x00: "Invalid code", // Invalid opcode.
  0x01: "Success", // Operation successful.
  0x02: "Opcode not supported", // Opcode not supported.
  0x03: "Invalid parameter", // Missing or invalid parameter value.
  0x04: "Insufficient resources", // Not enough memory for the data object.
  0x05: "Invalid object", // Data object does not match the firmware and hardware requirements, the signature is wrong, or parsing the command failed.
  0x07: "Unsupported type", // Not a valid object type for a Create request.
  0x08: "Operation not permitted", // The state of the DFU process does not allow this operation.
  0x0a: "Operation failed", // Operation failed.
  0x0b: "Extended error" // Extended error.
};

var EXTENDED_ERROR = {
  0x00: "No error", // No extended error code has been set. This error indicates an implementation problem.
  0x01: "Invalid error code", // Invalid error code. This error code should never be used outside of development.
  0x02: "Wrong command format", // The format of the command was incorrect.
  0x03: "Unknown command", // The command was successfully parsed, but it is not supported or unknown.
  0x04: "Init command invalid", // The init command is invalid. The init packet either has an invalid update type or it is missing required fields for the update type.
  0x05: "Firmware version failure", // The firmware version is too low. For an application, the version must be greater than the current application. For a bootloader, it must be greater than or equal to the current version.
  0x06: "Hardware version failure", // The hardware version of the device does not match the required hardware version for the update.
  0x07: "Softdevice version failure", // The array of supported SoftDevices for the update does not contain the FWID of the current SoftDevice.
  0x08: "Signature missing", // The init packet does not contain a signature.
  0x09: "Wrong hash type", // The hash type that is specified by the init packet is not supported by the DFU bootloader.
  0x0a: "Hash failed", // The hash of the firmware image cannot be calculated.
  0x0b: "Wrong signature type", // The type of the signature is unknown or not supported by the DFU bootloader.
  0x0c: "Verification failed", // The hash of the received firmware image does not match the hash in the init packet.
  0x0d: "Insufficient space" // The available space on the device is insufficient to hold the firmware.
};

var STATES = exports.STATES = {
  CONNECTING: 0,
  STARTING: 1,
  UPLOADING: 3,
  DISCONNECTING: 5,
  COMPLETED: 6,
  ABORTED: 7
};

var SecureDFU = function (_EventEmitter) {
  _inherits(SecureDFU, _EventEmitter);

  function SecureDFU(crc) {
    _classCallCheck(this, SecureDFU);

    var _this = _possibleConstructorReturn(this, (SecureDFU.__proto__ || Object.getPrototypeOf(SecureDFU)).call(this));

    _this.crc32 = crc;
    _this.events = {};
    _this.notifyFns = {};
    _this.controlChar = null;
    _this.packetChar = null;
    _this.isAborted = false;
    return _this;
  }

  _createClass(SecureDFU, [{
    key: "log",
    value: function log(message) {
      this.emit("log", { message: message });
    }
  }, {
    key: "error",
    value: function error(err) {
      this.emit("error", err);
    }
  }, {
    key: "state",
    value: function state(_state) {
      this.emit("stateChanged", { state: _state });
    }
  }, {
    key: "progress",
    value: function progress(bytes) {
      this.emit("progress", {
        object: "unknown",
        totalBytes: 0,
        currentBytes: bytes
      });
    }
  }, {
    key: "update",
    value: function () {
      var _ref = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee(device, init, firmware) {
        var _this2 = this;

        var disconnectWatcher;
        return regeneratorRuntime.wrap(function _callee$(_context) {
          while (1) {
            switch (_context.prev = _context.next) {
              case 0:
                this.isAborted = false;

                if (device) {
                  _context.next = 3;
                  break;
                }

                throw new Error("Device not specified");

              case 3:
                if (init) {
                  _context.next = 5;
                  break;
                }

                throw new Error("Init not specified");

              case 5:
                if (firmware) {
                  _context.next = 7;
                  break;
                }

                throw new Error("Firmware not specified");

              case 7:

                this.state(STATES.CONNECTING);
                disconnectWatcher = new Promise(function (resolve, reject) {
                  device.once("disconnect", function () {
                    _this2.controlChar = null;
                    _this2.packetChar = null;
                    reject('disconnected');
                  });
                });
                _context.next = 11;
                return Promise.race([this.doUpdate(device, init, firmware), disconnectWatcher]);

              case 11:
                return _context.abrupt("return", this.disconnect(device));

              case 12:
              case "end":
                return _context.stop();
            }
          }
        }, _callee, this);
      }));

      function update(_x, _x2, _x3) {
        return _ref.apply(this, arguments);
      }

      return update;
    }()
  }, {
    key: "doUpdate",
    value: function () {
      var _ref2 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee2(device, init, firmware) {
        return regeneratorRuntime.wrap(function _callee2$(_context2) {
          while (1) {
            switch (_context2.prev = _context2.next) {
              case 0:
                _context2.next = 2;
                return this.connect(device);

              case 2:
                this.log("transferring init");
                this.state(STATES.STARTING);
                // await this.transferInit(init, 3)
                _context2.next = 6;
                return this.sendInitPacket(init);

              case 6:
                this.log("transferring firmware");
                this.state(STATES.UPLOADING);
                // await this.transferFirmware(init, firmware, 3)
                _context2.next = 10;
                return this.sendFirmware(firmware);

              case 10:
                this.state(STATES.COMPLETED);

              case 11:
              case "end":
                return _context2.stop();
            }
          }
        }, _callee2, this);
      }));

      function doUpdate(_x4, _x5, _x6) {
        return _ref2.apply(this, arguments);
      }

      return doUpdate;
    }()
  }, {
    key: "abort",
    value: function abort() {
      this.isAborted = true;
    }
  }, {
    key: "connect",
    value: function () {
      var _ref3 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee3(device) {
        var _this3 = this;

        var characteristics;
        return regeneratorRuntime.wrap(function _callee3$(_context3) {
          while (1) {
            switch (_context3.prev = _context3.next) {
              case 0:
                _context3.next = 2;
                return this.gattConnect(device);

              case 2:
                characteristics = _context3.sent;

                this.log("found " + characteristics.length + " characteristic(s)");

                this.packetChar = characteristics.find(function (characteristic) {
                  return getCanonicalUUID(characteristic.uuid) === PACKET_UUID;
                });

                if (this.packetChar) {
                  _context3.next = 7;
                  break;
                }

                throw new Error("Unable to find packet characteristic");

              case 7:
                this.log("found packet characteristic");

                this.controlChar = characteristics.find(function (characteristic) {
                  return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID;
                });

                if (this.controlChar) {
                  _context3.next = 11;
                  break;
                }

                throw new Error("Unable to find control characteristic");

              case 11:
                this.log("found control characteristic");

                if (!(!this.controlChar.properties.includes("notify") && !this.controlChar.properties.includes("indicate"))) {
                  _context3.next = 14;
                  break;
                }

                throw new Error("Control characteristic does not allow notifications");

              case 14:
                this.controlChar.on("data", this.handleNotification.bind(this));
                return _context3.abrupt("return", new Promise(function (resolve, reject) {
                  _this3.controlChar.notify(true, function (error) {
                    _this3.log("enabled control notifications");
                    if (error) return reject(error);
                    resolve(device);
                  });
                }));

              case 16:
              case "end":
                return _context3.stop();
            }
          }
        }, _callee3, this);
      }));

      function connect(_x7) {
        return _ref3.apply(this, arguments);
      }

      return connect;
    }()
  }, {
    key: "gattConnect",
    value: function () {
      var _ref4 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee4(device) {
        var service;
        return regeneratorRuntime.wrap(function _callee4$(_context4) {
          while (1) {
            switch (_context4.prev = _context4.next) {
              case 0:
                _context4.next = 2;
                return new Promise(function (resolve, reject) {
                  if (device.state === "connected") return resolve(device);
                  device.connect(function (error) {
                    if (error) return reject(error);
                    resolve(device);
                  });
                });

              case 2:
                this.log("connected to gatt server");
                _context4.next = 5;
                return this.getDFUService(device).catch(function () {
                  throw new Error("Unable to find DFU service");
                });

              case 5:
                service = _context4.sent;

                this.log("found DFU service");
                return _context4.abrupt("return", this.getDFUCharacteristics(service));

              case 8:
              case "end":
                return _context4.stop();
            }
          }
        }, _callee4, this);
      }));

      function gattConnect(_x8) {
        return _ref4.apply(this, arguments);
      }

      return gattConnect;
    }()
  }, {
    key: "disconnect",
    value: function disconnect(device) {
      var _this4 = this;

      this.log("complete, disconnecting...");
      this.state(STATES.DISCONNECTING);
      return new Promise(function (resolve, reject) {
        device.disconnect(function (error) {
          if (error) {
            reject(error);
          }
        });
        device.once("disconnect", function () {
          _this4.log("disconnect");
          resolve();
        });
      });
    }
  }, {
    key: "getDFUService",
    value: function getDFUService(device) {
      return new Promise(function (resolve, reject) {
        device.discoverServices([SERVICE_UUID], function (error, services) {
          if (error) return reject(error);
          resolve(services[0]);
        });
      });
    }
  }, {
    key: "getDFUCharacteristics",
    value: function getDFUCharacteristics(service) {
      return new Promise(function (resolve, reject) {
        service.discoverCharacteristics([], function (error, characteristics) {
          if (error) return reject(error);
          resolve(characteristics);
        });
      });
    }
  }, {
    key: "setDfuMode",
    value: function setDfuMode(device) {
      var _this5 = this;

      return this.gattConnect(device).then(function (characteristics) {
        _this5.log("found " + characteristics.length + " characteristic(s)");

        var controlChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === CONTROL_UUID;
        });
        var packetChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === PACKET_UUID;
        });

        if (controlChar && packetChar) {
          return device;
        }

        var buttonChar = characteristics.find(function (characteristic) {
          return getCanonicalUUID(characteristic.uuid) === BUTTON_UUID;
        });

        if (!buttonChar) {
          throw new Error("Unsupported device");
        }

        // Support buttonless devices
        _this5.log("found buttonless characteristic");
        if (!buttonChar.properties.includes("notify") && !buttonChar.properties.includes("indicate")) {
          throw new Error("Buttonless characteristic does not allow notifications");
        }

        return new Promise(function (resolve, reject) {
          buttonChar.notify(true, function (error) {
            if (error) return reject(error);
            resolve();
          });
        }).then(function () {
          _this5.log("enabled buttonless notifications");
          buttonChar.on("data", _this5.handleNotification.bind(_this5));
          _this5.sendOperation(buttonChar, OPERATIONS.BUTTON_COMMAND);
        }).then(function () {
          _this5.log("sent dfu mode");
          return new Promise(function (resolve) {
            device.once("disconnect", function () {
              resolve();
            });
          });
        });
      });
    }
  }, {
    key: "handleNotification",
    value: function handleNotification(data) {
      var view = bufferToDataView(data);

      if (OPERATIONS.RESPONSE.indexOf(view.getUint8(0)) < 0) {
        throw new Error("Unrecognised control characteristic response notification");
      }

      var operation = view.getUint8(1);
      if (this.notifyFns[operation]) {
        var result = view.getUint8(2);
        var error = null;

        if (result === 0x01) {
          var _data = new DataView(view.buffer, 3);
          this.notifyFns[operation].resolve(_data);
        } else if (result === 0x0b) {
          var code = view.getUint8(3);
          error = "Error: " + EXTENDED_ERROR[code];
        } else {
          error = "Error: " + RESPONSE[result];
        }

        if (error) {
          this.error(error);
          this.notifyFns[operation].reject(error);
        }
        delete this.notifyFns[operation];
      }
    }
  }, {
    key: "sendControl",
    value: function sendControl(operation, buffer) {
      return this.sendOperation(this.controlChar, operation, buffer);
    }
  }, {
    key: "sendOperation",
    value: function sendOperation(characteristic, operation, buffer) {
      var _this6 = this;

      return new Promise(function (resolve, reject) {
        var size = operation.length;
        if (buffer) size += buffer.byteLength;

        var value = new Uint8Array(size);
        value.set(operation);
        if (buffer) {
          var data = new Uint8Array(buffer);
          value.set(data, operation.length);
        }

        _this6.notifyFns[operation[0]] = {
          resolve: resolve,
          reject: reject
        };
        writeCharacteristic(characteristic, new Buffer(value), false);
      });
    }
  }, {
    key: "sendInitPacket",
    value: function () {
      var _ref5 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee5(buffer) {
        var initPacketSizeInBytes, response, maxSize, offset, crc, skipSendingInitPacket, resumeSendingInitPacket, transferred, attempt, view, data, _response, _crc, _transferred, responsedata;

        return regeneratorRuntime.wrap(function _callee5$(_context5) {
          while (1) {
            switch (_context5.prev = _context5.next) {
              case 0:
                this.bailOnAbort();
                initPacketSizeInBytes = buffer.byteLength;
                // First, select the Command Object. As a response the maximum command size and information whether there is already
                // a command saved from a previous connection is returned.

                this.log("requesting init state");
                _context5.next = 5;
                return this.sendControl(OPERATIONS.SELECT_COMMAND);

              case 5:
                response = _context5.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                this.log("received maxSize: " + maxSize + ", offset: " + offset + ", crc: " + crc);

                // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local init packet CRC
                // and resume sending the init packet, or even skip sending it if the whole file was sent before.
                skipSendingInitPacket = false;
                resumeSendingInitPacket = false;

                if (offset > 0 && offset <= initPacketSizeInBytes) {
                  this.log("offset is between 0 and buffer size (" + initPacketSizeInBytes + ")");
                  // Read the same number of bytes from the current init packet to calculate local CRC32
                  transferred = buffer.slice(0, offset);

                  this.log(transferred.byteLength);
                  // Calculate the CRC32
                  if (this.checkCrc(transferred, crc)) {
                    if (offset === initPacketSizeInBytes) {
                      this.log("The offset equals the init package size. Will skip sending init package");
                      // The whole init packet was sent and it is equal to one we try to send now.
                      // There is no need to send it again. We may try to resume sending data.
                      skipSendingInitPacket = true;
                    } else {
                      this.log("The offset is not equal to the init package size. Will resume sending init package");
                      resumeSendingInitPacket = true;
                    }
                  } else {
                    this.log("A different init package was sent before, or an error occurred while sending. Resending");
                    // A different Init packet was sent before, or the error occurred while sending.
                    // We have to send the whole Init packet again.
                    offset = 0;
                  }
                }

                if (skipSendingInitPacket) {
                  _context5.next = 58;
                  break;
                }

                attempt = 1;

              case 15:
                if (!(attempt <= 3)) {
                  _context5.next = 56;
                  break;
                }

                if (resumeSendingInitPacket) {
                  _context5.next = 25;
                  break;
                }

                // Create the Init object
                // private static final int OP_CODE_CREATE_KEY = 0x01;
                // private static final int OBJECT_COMMAND = 0x01;
                this.log("creating init object");
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, initPacketSizeInBytes, LITTLE_ENDIAN);
                _context5.next = 22;
                return this.sendControl(OPERATIONS.CREATE_COMMAND, view.buffer);

              case 22:
                this.log("creat command finished");
                _context5.next = 26;
                break;

              case 25:
                this.log("resuming sending init package: attempt " + attempt);

              case 26:
                // Write Init data to the Packet Characteristic
                data = buffer.slice(offset);

                this.log("transfering data starting with offset: " + offset);
                _context5.next = 30;
                return this.transferData(data, offset);

              case 30:
                this.log("transferred data");

                // Calculate Checksum
                this.log("Calculating checksum");
                _context5.next = 34;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 34:
                _response = _context5.sent;
                _crc = _response.getInt32(4, LITTLE_ENDIAN);
                _transferred = _response.getUint32(0, LITTLE_ENDIAN);
                responsedata = buffer.slice(0, _transferred);

                this.log("Received checksum: crc: " + _crc + ", transferred: " + _transferred);

                if (!this.checkCrc(responsedata, _crc)) {
                  _context5.next = 44;
                  break;
                }

                this.log("checksum ok");
                // Everything is OK, we can proceed
                return _context5.abrupt("break", 56);

              case 44:
                if (!(attempt < 3)) {
                  _context5.next = 51;
                  break;
                }

                this.log("Starting next attempt #" + attempt);
                attempt++;
                // Go back to the beginning, we will send the whole Init packet again
                resumeSendingInitPacket = false;
                offset = 0;
                _context5.next = 54;
                break;

              case 51:
                this.error("crc doesn't match");
                this.log("crc doesn't match");
                return _context5.abrupt("return", false);

              case 54:
                _context5.next = 15;
                break;

              case 56:
                _context5.next = 59;
                break;

              case 58:
                this.log("skipped sending init package");

              case 59:

                // Execute Init packet. It's better to execute it twice than not execute at all...
                this.log("executing");
                _context5.next = 62;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 62:
                this.log("finished executing");
                return _context5.abrupt("return", true);

              case 64:
              case "end":
                return _context5.stop();
            }
          }
        }, _callee5, this);
      }));

      function sendInitPacket(_x9) {
        return _ref5.apply(this, arguments);
      }

      return sendInitPacket;
    }()
  }, {
    key: "sendFirmware",
    value: function () {
      var _ref6 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee6(buffer) {
        var response, maxSize, offset, crc, imageSizeInBytes, chunkCount, currentChunk, resumeSendingData, bytesSentAndExecuted, bytesSentNotExecuted, transferred, attempt, end, start, view, data, _response2, _transferred2, bytesLost, responsedata;

        return regeneratorRuntime.wrap(function _callee6$(_context6) {
          while (1) {
            switch (_context6.prev = _context6.next) {
              case 0:
                this.bailOnAbort();
                // SELECT_DATA: [0x06, 0x02],
                this.log("requesting firmware state");
                _context6.next = 4;
                return this.sendControl(OPERATIONS.SELECT_DATA);

              case 4:
                response = _context6.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                this.log("received maxSize: " + maxSize + ", offset: " + offset + ", crc: " + crc);

                imageSizeInBytes = buffer.byteLength;

                // Number of chunks in which the data will be sent

                chunkCount = (imageSizeInBytes + maxSize - 1) / maxSize;
                currentChunk = 0;
                resumeSendingData = false;

                // Can we resume? If the offset obtained from the device is greater then zero we can compare it with the local CRC
                // and resume sending the data.

                if (!(offset > 0)) {
                  _context6.next = 32;
                  break;
                }

                currentChunk = offset / maxSize;
                bytesSentAndExecuted = maxSize * currentChunk;
                bytesSentNotExecuted = offset - bytesSentAndExecuted;

                // If the offset is dividable by maxSize, assume that the last page was not executed

                if (bytesSentNotExecuted === 0) {
                  bytesSentAndExecuted -= maxSize;
                  bytesSentNotExecuted = maxSize;
                }

                transferred = buffer.slice(0, offset);

                if (!this.checkCrc(transferred, crc)) {
                  _context6.next = 31;
                  break;
                }

                if (!(bytesSentNotExecuted === maxSize && offset < imageSizeInBytes)) {
                  _context6.next = 28;
                  break;
                }

                this.log("firmware already transferred");
                this.log("executing");
                _context6.next = 25;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 25:
                this.log("finished executing");
                _context6.next = 29;
                break;

              case 28:
                resumeSendingData = true;

              case 29:
                _context6.next = 32;
                break;

              case 31:
                // The CRC of the current object is not correct. If there was another Data object sent before, its CRC must have been correct,
                // as it has been executed. Either way, we have to create the current object again.
                offset -= bytesSentNotExecuted;

              case 32:
                if (!(offset < imageSizeInBytes)) {
                  _context6.next = 86;
                  break;
                }

                attempt = 1;
                end = 0;
                // Each page will be sent in MAX_ATTEMPTS

              case 35:
                this.log("starting attempt #" + attempt);
                start = offset - offset % maxSize;

                end = Math.min(start + maxSize, buffer.byteLength);

                if (resumeSendingData) {
                  _context6.next = 46;
                  break;
                }

                // Create the Data object
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, end - start, LITTLE_ENDIAN);
                this.log("creating data object: size: " + (end - start));
                _context6.next = 44;
                return this.sendControl(OPERATIONS.CREATE_DATA, view.buffer);

              case 44:
                _context6.next = 47;
                break;

              case 46:
                resumeSendingData = false;

              case 47:
                data = buffer.slice(start, end);

                this.log("transfering data starting with offset: " + offset);
                _context6.next = 51;
                return this.transferData(data, start);

              case 51:
                this.log("transferred data");

                // Calculate Checksum
                this.log("Calculating checksum");
                _context6.next = 55;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 55:
                _response2 = _context6.sent;

                crc = _response2.getInt32(4, LITTLE_ENDIAN);
                _transferred2 = _response2.getUint32(0, LITTLE_ENDIAN);

                this.log("Received checksum: crc: " + crc + ", transferred: " + _transferred2);

                // It may happen, that not all bytes that were sent were received by the remote device
                bytesLost = end - _transferred2;

                this.log("Bytes lost: " + bytesLost);

                responsedata = buffer.slice(0, _transferred2);

                if (!this.checkCrc(responsedata, crc)) {
                  _context6.next = 75;
                  break;
                }

                if (!(bytesLost > 0)) {
                  _context6.next = 66;
                  break;
                }

                resumeSendingData = true;
                return _context6.abrupt("continue", 83);

              case 66:
                this.log("written " + _transferred2 + " bytes");
                _context6.next = 69;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 69:
                // Increment iterator
                currentChunk++;
                attempt = 1;
                offset = _transferred2;

                this.log("Next chunk: currentChunk: " + currentChunk + ", attempt: " + attempt + ", offset: " + offset);
                _context6.next = 83;
                break;

              case 75:
                if (!(attempt < MAX_ATTEMPTS)) {
                  _context6.next = 80;
                  break;
                }

                // try again with same offset
                this.log("Starting next attempt: " + attempt);
                attempt++;
                _context6.next = 83;
                break;

              case 80:
                this.error("crc doesn't match");
                this.log("crc doesn't match");
                return _context6.abrupt("return", false);

              case 83:
                if (end < buffer.byteLength) {
                  _context6.next = 35;
                  break;
                }

              case 84:
                _context6.next = 90;
                break;

              case 86:
                // Looks as if the whole file was sent correctly but has not been executed
                this.log("Executing");
                _context6.next = 89;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 89:
                this.log("Finished executing");

              case 90:
                return _context6.abrupt("return", true);

              case 91:
              case "end":
                return _context6.stop();
            }
          }
        }, _callee6, this);
      }));

      function sendFirmware(_x10) {
        return _ref6.apply(this, arguments);
      }

      return sendFirmware;
    }()
  }, {
    key: "transferInit",
    value: function () {
      var _ref7 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee7(buffer, tryCount, forceInit) {
        var response, maxSize, offset, crc, transferred;
        return regeneratorRuntime.wrap(function _callee7$(_context7) {
          while (1) {
            switch (_context7.prev = _context7.next) {
              case 0:
                this.bailOnAbort();

                _context7.next = 3;
                return this.sendControl(OPERATIONS.SELECT_COMMAND);

              case 3:
                response = _context7.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);

                if (!forceInit) {
                  _context7.next = 12;
                  break;
                }

                this.log("forced init retransferring init");
                offset = 0;
                _context7.next = 15;
                break;

              case 12:
                if (!(!forceInit && offset === buffer.byteLength && this.checkCrc(buffer, crc))) {
                  _context7.next = 15;
                  break;
                }

                // await this.sendControl(OPERATIONS.EXECUTE)
                this.log("init packet already available, skipping transfer");
                return _context7.abrupt("return");

              case 15:
                transferred = buffer.slice(0, offset);

                if (this.checkCrc(transferred, crc)) {
                  _context7.next = 22;
                  break;
                }

                tryCount--;

                if (!(tryCount === 0)) {
                  _context7.next = 20;
                  break;
                }

                throw new Error("could not validate init packet");

              case 20:
                this.log("init crc check failed retrying");
                return _context7.abrupt("return", this.transferInit(buffer, tryCount, true));

              case 22:
                this.log("init resuming transfer at " + offset + " with max size " + maxSize);

                this.progress = function (bytes) {
                  this.emit("progress", {
                    object: "init",
                    totalBytes: buffer.byteLength,
                    currentBytes: bytes
                  });
                };
                this.progress(0);

                return _context7.abrupt("return", this.transferObject(buffer, OPERATIONS.CREATE_COMMAND, maxSize, offset));

              case 26:
              case "end":
                return _context7.stop();
            }
          }
        }, _callee7, this);
      }));

      function transferInit(_x11, _x12, _x13) {
        return _ref7.apply(this, arguments);
      }

      return transferInit;
    }()
  }, {
    key: "transferFirmware",
    value: function () {
      var _ref8 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee8(initBuffer, buffer, tryCount) {
        var response, maxSize, offset, crc, transferred;
        return regeneratorRuntime.wrap(function _callee8$(_context8) {
          while (1) {
            switch (_context8.prev = _context8.next) {
              case 0:
                this.bailOnAbort();

                _context8.next = 3;
                return this.sendControl(OPERATIONS.SELECT_DATA);

              case 3:
                response = _context8.sent;
                maxSize = response.getUint32(0, LITTLE_ENDIAN);
                offset = response.getUint32(4, LITTLE_ENDIAN);
                crc = response.getInt32(8, LITTLE_ENDIAN);
                transferred = buffer.slice(0, offset);

                if (this.checkCrc(transferred, crc)) {
                  _context8.next = 14;
                  break;
                }

                tryCount--;

                if (!(tryCount == 0)) {
                  _context8.next = 12;
                  break;
                }

                throw new Error("could not validate firmware packet");

              case 12:
                this.log("firmware crc check failed retrying " + offset);
                //await this.transferInit(initBuffer, 3, true)
                // return this.transferFirmware(initBuffer, buffer, tryCount)
                offset = 0;

              case 14:
                this.log("firmware resuming transfer at " + offset + " with max size " + maxSize);

                this.progress = function (bytes) {
                  this.emit("progress", {
                    object: "firmware",
                    totalBytes: buffer.byteLength,
                    currentBytes: bytes
                  });
                };
                this.progress(0);

                return _context8.abrupt("return", this.transferObject(buffer, OPERATIONS.CREATE_DATA, maxSize, offset));

              case 18:
              case "end":
                return _context8.stop();
            }
          }
        }, _callee8, this);
      }));

      function transferFirmware(_x14, _x15, _x16) {
        return _ref8.apply(this, arguments);
      }

      return transferFirmware;
    }()
  }, {
    key: "transferObject",
    value: function () {
      var _ref9 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee9(buffer, createType, maxSize, offset) {
        var start, end, view, data, response, crc, transferred, responsedata;
        return regeneratorRuntime.wrap(function _callee9$(_context9) {
          while (1) {
            switch (_context9.prev = _context9.next) {
              case 0:
                this.bailOnAbort();

                start = offset - offset % maxSize;
                end = Math.min(start + maxSize, buffer.byteLength);

                this.log("transfer object from " + start + "-" + end + " total size " + buffer.byteLength + " bytes");
                view = new DataView(new ArrayBuffer(4));

                view.setUint32(0, end - start, LITTLE_ENDIAN);

                _context9.next = 8;
                return this.sendControl(createType, view.buffer);

              case 8:
                data = buffer.slice(start, end);
                _context9.next = 11;
                return this.transferData(data, start);

              case 11:
                _context9.next = 13;
                return this.sendControl(OPERATIONS.CALCULATE_CHECKSUM);

              case 13:
                response = _context9.sent;
                crc = response.getInt32(4, LITTLE_ENDIAN);
                transferred = response.getUint32(0, LITTLE_ENDIAN);
                responsedata = buffer.slice(0, transferred);

                if (!this.checkCrc(responsedata, crc)) {
                  _context9.next = 24;
                  break;
                }

                this.log("written " + transferred + " bytes");
                offset = transferred;

                _context9.next = 22;
                return this.sendControl(OPERATIONS.EXECUTE);

              case 22:
                _context9.next = 25;
                break;

              case 24:
                this.error("object failed to validate");

              case 25:
                if (!(end < buffer.byteLength)) {
                  _context9.next = 30;
                  break;
                }

                _context9.next = 28;
                return this.transferObject(buffer, createType, maxSize, offset);

              case 28:
                _context9.next = 31;
                break;

              case 30:
                this.log("transfer complete");

              case 31:
              case "end":
                return _context9.stop();
            }
          }
        }, _callee9, this);
      }));

      function transferObject(_x17, _x18, _x19, _x20) {
        return _ref9.apply(this, arguments);
      }

      return transferObject;
    }()
  }, {
    key: "transferData",
    value: function () {
      var _ref10 = _asyncToGenerator( /*#__PURE__*/regeneratorRuntime.mark(function _callee10(data, offset, start) {
        var end, packet, buffer;
        return regeneratorRuntime.wrap(function _callee10$(_context10) {
          while (1) {
            switch (_context10.prev = _context10.next) {
              case 0:
                start = start || 0;
                end = Math.min(start + PACKET_SIZE, data.byteLength);
                packet = data.slice(start, end);
                buffer = new Buffer(packet);


                this.log("Writing from " + start + " to " + end);
                _context10.next = 7;
                return writeCharacteristic(this.packetChar, buffer);

              case 7:
                this.log("Finished writing");
                this.progress(offset + end);

                if (!(end < data.byteLength)) {
                  _context10.next = 11;
                  break;
                }

                return _context10.abrupt("return", this.transferData(data, offset, end));

              case 11:
              case "end":
                return _context10.stop();
            }
          }
        }, _callee10, this);
      }));

      function transferData(_x21, _x22, _x23) {
        return _ref10.apply(this, arguments);
      }

      return transferData;
    }()
  }, {
    key: "checkCrc",
    value: function checkCrc(buffer, crc) {
      if (!this.crc32) {
        this.log("crc32 not found, skipping CRC check");
        return true;
      }

      var ourCrc = this.crc32(new Uint8Array(buffer));
      this.log("Our calculated crc: " + ourCrc + ", received: " + crc);
      return crc === ourCrc;
    }
  }, {
    key: "bailOnAbort",
    value: function bailOnAbort() {
      if (this.isAborted) {
        this.state(STATES.ABORTED);
        throw new Error("aborted");
      }
    }
  }]);

  return SecureDFU;
}(_events2.default);

exports.SecureDFU = SecureDFU;
SecureDFU.SERVICE_UUID = SERVICE_UUID;


function bufferToDataView(buffer) {
  // Buffer to ArrayBuffer
  var arrayBuffer = new Uint8Array(buffer).buffer;
  return new DataView(arrayBuffer);
}

function dataViewToBuffer(dataView) {
  // DataView to TypedArray
  var typedArray = new Uint8Array(dataView.buffer);
  return new Buffer(typedArray);
}

function getCanonicalUUID(uuid) {
  if (typeof uuid === "number") uuid = uuid.toString(16);
  uuid = uuid.toLowerCase();
  if (uuid.length <= 8) uuid = ("00000000" + uuid).slice(-8) + "-0000-1000-8000-00805f9b34fb";
  if (uuid.length === 32) uuid = uuid.match(/^([0-9a-f]{8})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{4})([0-9a-f]{12})$/).splice(1).join("-");
  return uuid;
}

var isWindows = /^win32/.test(process.platform);

var defaultWithoutResponse = !isWindows;

function writeCharacteristic(characteristic, buffer) {
  var withoutResponse = arguments.length > 2 && arguments[2] !== undefined ? arguments[2] : defaultWithoutResponse;

  return new Promise(function (resolve, reject) {
    characteristic.write(buffer, withoutResponse, function (error) {
      if (error) return reject(error);
      resolve();
    });
  });
}