// Jeedom Platform plugin for HomeBridge
//
// Remember to add platform to config.json. Example:
// "platforms": [
//     {
//             "platform": "Jeedom",
//             "url": "PUT URL OF YOUR JEEDOM HERE",
//             "apikey": "PUT APIKEY OF YOUR JEEDOM HERE",
//             "grouping": "PUT none OR room",
//             "pollerperiod": "PUT 0 FOR DISABLING POLLING, 1 - 100 INTERVAL IN SECONDS. 2 SECONDS IS THE DEFAULT"
//     }
// ],
//
// When you attempt to add a device, it will ask for a "PIN code".
// The default code for all HomeBridge accessories is 031-45-154.

'use strict';

var Accessory, Service, Characteristic, UUIDGen;
var http = require('http');
var inherits = require('util').inherits;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;

	// Custom Services and Characteristics
	Characteristic.TimeInterval = function() {
		Characteristic.call(this, 'Time Interval', '2A6529B5-5825-4AF3-AD52-20288FBDA115');
		this.setProps({
			format : Characteristic.Formats.FLOAT,
			unit : Characteristic.Units.SECONDS,
			maxValue : 21600, // 12 hours
			minValue : 0,
			minStep : 900, // 15 min
			perms : [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TimeInterval, Characteristic);
	Characteristic.TimeInterval.UUID = '2A6529B5-5825-4AF3-AD52-20288FBDA115';

	Characteristic.CurrentPowerConsumption = function() {
		Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.UINT16,
			unit : "watts",
			maxValue : 1000000000,
			minValue : 0,
			minStep : 1,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.CurrentPowerConsumption, Characteristic);
	Characteristic.CurrentPowerConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

	Characteristic.TotalPowerConsumption = function() {
		Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.FLOAT, // Deviation from Eve Energy observed type
			unit : "kilowatthours",
			maxValue : 1000000000,
			minValue : 0,
			minStep : 0.001,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TotalPowerConsumption, Characteristic);
	Characteristic.TotalPowerConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

	/**
	 * Custom Service "Power Monitor"
	 */

	Service.PowerMonitor = function(displayName, subtype) {
		Service.call(this, displayName, '0EB29E08-C307-498E-8E1A-4EDC5FF70607', subtype);

		// Required Characteristics
		this.addCharacteristic(Characteristic.CurrentPowerConsumption);
		this.addCharacteristic(Characteristic.TotalPowerConsumption);

		// Optional Characteristics

	};
	inherits(Service.PowerMonitor, Service);
	Service.PowerMonitor.UUID = '0EB29E08-C307-498E-8E1A-4EDC5FF70607';

	// End of custom Services and Characteristics

	homebridge.registerPlatform("homebridge-jeedom", "Jeedom", JeedomPlatform, true);
};
function JeedomPlatform(log, config, api) {
	this.config = config || {};
	this.api = api;
	this.accessories = [];
	this.log = log;
	if (config["url"] == "undefined" || config["url"] == "http://:80") {
		this.log("Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
	}
	this.jeedomClient = require('./lib/jeedom-api').createClient(config["url"], config["apikey"]);
	this.grouping = config["grouping"];
	if (this.grouping == undefined) {
		this.grouping = "none";
	}
	this.rooms = {};
	this.updateSubscriptions = [];
	this.lastPoll = 0;
	this.pollingUpdateRunning = false;
	this.pollerPeriod = config["pollerperiod"];
	if ( typeof this.pollerPeriod == 'string')
		this.pollerPeriod = parseInt(this.pollerPeriod);
	else if (this.pollerPeriod == undefined)
		this.pollerPeriod = 5;

	var self = this;
	this.requestServer = http.createServer();
	this.requestServer.on('error', function(err) {

	});
	this.requestServer.listen(18091, function() {
		self.log("Server Listening...");
	});

	if (api) {
		// Save the API object as plugin needs to register new accessory via this object.
		this.api = api;

		// Listen to event "didFinishLaunching", this means homebridge already finished loading cached accessories
		// Platform Plugin should only register new accessory that doesn't exist in homebridge after this event.
		// Or start discover new accessories
		this.api.on('didFinishLaunching', function() {
			this.addAccessories();
		}.bind(this));
	}
}

JeedomPlatform.prototype.addAccessories = function() {
	this.log("Fetching Jeedom Objects ...");
	var that = this;
	this.jeedomClient.getRooms().then(function(rooms) {
		//console.log("pieces :"+JSON.stringify(rooms));
		rooms.map(function(s, i, a) {
			that.rooms[s.id] = s.name;
			//that.log('New Room >' + s.name);
		});
		that.log("Fetching Jeedom devices ...");
		return that.jeedomClient.getDevices();
	}).then(function(devices) {
		that.JeedomDevices2HomeKitAccessories(devices);
	}).catch(function(err, response) {
		that.log("#2 Error getting data from Jeedom: " + err + " " + response);
	});
};
JeedomPlatform.prototype.JeedomDevices2HomeKitAccessories = function(devices) {
	var foundAccessories = [];
	if (devices != undefined) {
		// Order results by roomID
		devices.sort(function compare(a, b) {
			if (a.object_id > b.object_id) {
				return -1;
			}
			if (a.object_id < b.object_id) {
				return 1;
			}
			return 0;
		});
		var currentRoomID = "";
		var services = [];
		var service = null;
		var that = this;
		devices.map(function(s, i, a) {
			if (s.isVisible == "1" && s.object_id != null && ( typeof s.configuration.sendToHomebridge === "undefined" || s.configuration.sendToHomebridge == 1)) {
				that.jeedomClient.getDeviceProperties(s.id).then(function(resultEqL) {
					that.jeedomClient.getDeviceCmd(s.id).then(function(resultCMD) {
						AccessoireCreateJeedom(that.jeedomClient.ParseGenericType(resultEqL, resultCMD));
					}).catch(function(err, response) {
						that.log("#4 Error getting data from Jeedom: " + err + " " + response);
					});
				}).catch(function(err, response) {
					that.log("#3 Error getting data from Jeedom: " + err + " " + response);
				});

				function AccessoireCreateJeedom(_params) {
					var cmds = _params;
					//console.log('PARAMS > '+JSON.stringify(_params));
					//that.log('Accessoire trouve // Name : '+_params.name);
					if (cmds.light) {
						var cmds2 = cmds;
						cmds.light.forEach(function(cmd, index, array) {
							if (cmd.color) {
								service = {
									controlService : new Service.Lightbulb(_params.name),
									characteristics : [Characteristic.On, Characteristic.Brightness, Characteristic.Hue, Characteristic.Saturation]
								};
								service.controlService.cmd_id = cmd.color.id;
								service.controlService.HSBValue = {
									hue : 0,
									saturation : 0,
									brightness : 0
								};
								service.controlService.RGBValue = {
									red : 0,
									green : 0,
									blue : 0
								};
								service.controlService.countColorCharacteristics = 0;
								service.controlService.timeoutIdColorCharacteristics = 0;
								service.controlService.subtype = "RGB";
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.color.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							} else {
								if (cmd.state) {
									var cmd_on = 0;
									var cmd_off = 0;
									var cmd_slider = 0;
									cmds2.light.forEach(function(cmd2, index2, array2) {
										if (cmd2.on) {
											if (cmd2.on.value == cmd.state.id) {
												cmd_on = cmd2.on.id;
											}
										} else if (cmd2.off) {
											if (cmd2.off.value == cmd.state.id) {
												cmd_off = cmd2.off.id;
											}
										} else if (cmd2.slider) {
											if (cmd2.slider.value == cmd.state.id) {
												cmd_slider = cmd2.slider.id;
											}
										}
									});
									if (cmd_slider == 0) {
										service = {
											controlService : new Service.Lightbulb(_params.name),
											characteristics : [Characteristic.On]
										};
									} else {
										service = {
											controlService : new Service.Lightbulb(_params.name),
											characteristics : [Characteristic.On, Characteristic.Brightness]
										};
									}
									service.controlService.cmd_id = cmds.light.id;
									if (service.controlService.subtype == undefined)
										service.controlService.subtype = "";
									service.controlService.subtype = _params.id + "-" + cmd.state.id + "|" + cmd_on + "|" + cmd_off + "|" + cmd_slider + "-" + service.controlService.subtype;
									services.push(service);
									service = null;
								}
							}
						});

					}
					if (cmds.flap) {
						var cmds2 = cmds;
						cmds.flap.forEach(function(cmd, index, array) {
							if (cmd.state) {
								var cmd_up = 0;
								var cmd_down = 0;
								var cmd_slider = 0;
								var cmd_stop = 0;
								cmds2.flap.forEach(function(cmd2, index2, array2) {
									if (cmd2.up) {
										if (cmd2.up.value == cmd.state.id) {
											cmd_up = cmd2.up.id;
										}
									} else if (cmd2.down) {
										if (cmd2.down.value == cmd.state.id) {
											cmd_down = cmd2.down.id;
										}
									} else if (cmd2.slider) {
										if (cmd2.slider.value == cmd.state.id) {
											cmd_slider = cmd2.slider.id;
										}
									} else if (cmd2.stop) {
										if (cmd2.stop.value == cmd.state.id) {
											stop = cmd2.stop.id;
										}
									}
								});
								service = {
									controlService : new Service.WindowCovering(_params.name),
									characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState]
								};
								service.controlService.cmd_id = cmd.state.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.state.id + "|" + cmd_down + "|" + cmd_up + "|" + cmd_slider + "|" + cmd_stop + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.energy) {
						var cmds2 = cmds;
						cmds.energy.forEach(function(cmd, index, array) {
							if (cmd.state) {
								var cmd_on = 0;
								var cmd_off = 0;
								cmds2.energy.forEach(function(cmd2, index2, array2) {
									if (cmd2.on) {
										if (cmd2.on.value == cmd.state.id) {
											cmd_on = cmd2.on.id;
										}
									} else if (cmd2.off) {
										if (cmd2.off.value == cmd.state.id) {
											cmd_off = cmd2.off.id;
										}
									}
								});
								service = {
									controlService : new Service.Switch(_params.name),
									characteristics : [Characteristic.On]
								};
								service.controlService.cmd_id = cmd.state.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.state.id + "|" + cmd_on + "|" + cmd_off + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.power || cmds.consumption) {
						cmds.power.forEach(function(cmd, index, array) {
							if (cmd.power || cmd.consumption) {
								service = {
									controlService : new Service.PowerMonitor(_params.name),
									characteristics : [Characteristic.CurrentPowerConsumption, Characteristic.TotalPowerConsumption]
								};
								if (cmd.power) {
									var cmd_id = cmd.power.id;
								} else {
									var cmd_id = cmd.consumption.id;
								}

								service.controlService.cmd_id = cmd_id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd_id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});

					}
					if (cmds.battery) {
						cmds.battery.forEach(function(cmd, index, array) {
							if (cmd.battery) {
								service = {
									controlService : new Service.BatteryService(_params.name),
									characteristics : [Characteristic.BatteryLevel]
								};
								service.controlService.cmd_id = cmd.battery.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.battery.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.presence) {
						cmds.presence.forEach(function(cmd, index, array) {
							if (cmd.presence) {
								service = {
									controlService : new Service.MotionSensor(_params.name),
									characteristics : [Characteristic.MotionDetected]
								};
								service.controlService.cmd_id = cmd.presence.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.presence.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.temperature) {
						cmds.temperature.forEach(function(cmd, index, array) {
							if (cmd.temperature) {
								service = {
									controlService : new Service.TemperatureSensor(_params.name),
									characteristics : [Characteristic.CurrentTemperature]
								};
								service.controlService.cmd_id = cmd.temperature.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.temperature.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});

					}
					if (cmds.humidity) {
						cmds.humidity.forEach(function(cmd, index, array) {
							if (cmd.humidity) {
								service = {
									controlService : new Service.HumiditySensor(_params.name),
									characteristics : [Characteristic.CurrentRelativeHumidity]
								};
								service.controlService.cmd_id = cmd.humidity.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.humidity.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.smoke) {
						cmds.smoke.forEach(function(cmd, index, array) {
							if (cmd.smoke) {
								service = {
									controlService : new Service.SmokeSensor(_params.name),
									characteristics : [Characteristic.SmokeDetected]
								};
								service.controlService.cmd_id = cmd.smoke.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.smoke.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.flood) {
						cmds.flood.forEach(function(cmd, index, array) {
							if (cmd.flood) {
								service = {
									controlService : new Service.LeakSensor(_params.name),
									characteristics : [Characteristic.LeakDetected]
								};
								service.controlService.cmd_id = cmd.flood.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.flood.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.opening) {
						cmds.opening.forEach(function(cmd, index, array) {
							if (cmd.opening) {
								service = {
									controlService : new Service.ContactSensor(_params.name),
									characteristics : [Characteristic.ContactSensorState]
								};
								service.controlService.cmd_id = cmd.opening.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.opening.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.brightness) {
						cmds.brightness.forEach(function(cmd, index, array) {
							if (cmd.brightness) {
								service = {
									controlService : new Service.LightSensor(_params.name),
									characteristics : [Characteristic.CurrentAmbientLightLevel]
								};
								service.controlService.cmd_id = cmd.brightness.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.brightness.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.energy2) {
						service = {
							controlService : new Service.Outlet(_params.name),
							characteristics : [Characteristic.On, Characteristic.OutletInUse]
						};
						if (service.controlService.subtype == undefined)
							service.controlService.subtype = "";
						service.controlService.subtype = _params.id + "-" + cmds.brightness.id + "-" + service.controlService.subtype;
						services.push(service);
						service = null;
					}
					if (cmds.lock) {
						cmds.lock.forEach(function(cmd, index, array) {
							if (cmd.lock) {
								service = {
									controlService : new Service.LockMechanism(_params.name),
									characteristics : [Characteristic.LockCurrentState, Characteristic.LockTargetState]
								};
								service.controlService.cmd_id = cmd.lock.id;
								if (service.controlService.subtype == undefined)
									service.controlService.subtype = "";
								service.controlService.subtype = _params.id + "-" + cmd.lock.id + "-" + service.controlService.subtype;
								services.push(service);
								service = null;
							}
						});
					}
					if (cmds.thermostat) {
						service = {
							controlService : new Service.Thermostat(_params.name),
							characteristics : [Characteristic.CurrentTemperature, Characteristic.TargetTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState]
						};
						service.controlService.cmd_id = cmds.thermostat.id;
						if (service.controlService.subtype == undefined)
							service.controlService.subtype = "";
						service.controlService.subtype = _params.id + "-" + cmds.thermostat.id + "-" + service.controlService.subtype;
						services.push(service);
						service = null;
					}
					if (cmds.alarm) {
						service = {
							controlService : new Service.SecuritySystem(_params.name),
							characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState]
						};
						service.controlService.cmd_id = cmds.alarm.id;
						if (service.controlService.subtype == undefined)
							service.controlService.subtype = "";
						service.controlService.subtype = _params.id + "-" + cmds.alarm.enable_state.id + "-" + cmds.alarm.state.id;
						services.push(service);
						service = null;
					}
					if (services.length != 0) {
						var a = that.createAccessory(services, _params.id, _params.name, _params.object_id);
						if (!that.accessories[a.uuid]) {
							that.addAccessory(a);
						}
						services = [];
					}
				}

			}
		});
	}
	this.log("Homebridge Plugin is running now !");
	if (this.pollerPeriod >= 1 && this.pollerPeriod <= 100)
		this.startPollingUpdate(0);
};
JeedomPlatform.prototype.createAccessory = function(services, id, name, currentRoomID) {
	var accessory = new JeedomBridgedAccessory(services);
	accessory.platform = this;
	accessory.name = (name) ? name : this.rooms[currentRoomID] + "-Devices";
	accessory.uuid = UUIDGen.generate(id + accessory.name + currentRoomID);
	accessory.model = "JeedomBridgedAccessory";
	accessory.manufacturer = "Jeedom";
	accessory.serialNumber = "<unknown>";
	return accessory;
};
JeedomPlatform.prototype.addAccessory = function(jeedomAccessory) {
	if (!jeedomAccessory) {
		return;
	}
	var newAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.uuid);
	jeedomAccessory.initAccessory(newAccessory);
	newAccessory.reachable = true;

	this.accessories[jeedomAccessory.UUID] = jeedomAccessory;
	this.log("Adding Accessory: " + jeedomAccessory.name);
	this.api.registerPlatformAccessories("homebridge-jeedom", "Jeedom", [newAccessory]);
};
JeedomPlatform.prototype.configureAccessory = function(accessory) {
	for (var s = 0; s < accessory.services.length; s++) {
		var service = accessory.services[s];
		if (service.subtype != undefined) {
			var subtypeParams = service.subtype.split("-");
			if (subtypeParams.length == 3 && subtypeParams[2] == "RGB") {
				service.HSBValue = {
					hue : 0,
					saturation : 0,
					brightness : 0
				};
				service.RGBValue = {
					red : 0,
					green : 0,
					blue : 0
				};
				service.countColorCharacteristics = 0;
				service.timeoutIdColorCharacteristics = 0;
			}
		}
		for (var i = 0; i < service.characteristics.length; i++) {
			var characteristic = service.characteristics[i];
			if (characteristic.props.needsBinding)
				this.bindCharacteristicEvents(characteristic, service);
		}
	}
	this.log("Configuring Accessory: " + accessory.displayName);
	this.accessories[accessory.UUID] = accessory;
	accessory.reachable = true;
};
JeedomPlatform.prototype.bindCharacteristicEvents = function(characteristic, service) {
	var onOff = characteristic.props.format == "bool" ? true : false;
	var readOnly = true;
	for (var i = 0; i < characteristic.props.perms.length; i++)
		if (characteristic.props.perms[i] == "pw")
			readOnly = false;
	var IDs = service.subtype.split("-");
	var propertyChanged = "value";
	if (service.HSBValue != undefined)
		propertyChanged = "color";
	this.subscribeUpdate(service, characteristic, onOff, propertyChanged);
	if (!readOnly) {
		characteristic.on('set', function(value, callback, context) {
			if (characteristic.UUID == '00000033-0000-1000-8000-0026BB765291') {
				console.log('set target mode');
			}
			if (context !== 'fromJeedom' && context !== 'fromSetValue') {
				if (characteristic.UUID == (new Characteristic.On()).UUID && service.isVirtual) {
					this.command("pressButton", IDs[1], service, IDs);
					setTimeout(function() {
						characteristic.setValue(false, undefined, 'fromSetValue');
					}, 100);
				} else if (characteristic.UUID == (new Characteristic.On()).UUID) {
					this.command(value == 0 ? "turnOff" : "turnOn", null, service, IDs);
				} else if (characteristic.UUID == (new Characteristic.TargetTemperature()).UUID) {
					if (Math.abs(value - characteristic.value) >= 0.5) {
						value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
						this.command("setTargetLevel", value, service, IDs);
					} else {
						value = characteristic.value;
					}
					setTimeout(function() {
						characteristic.setValue(value, undefined, 'fromSetValue');
					}, 100);
				} else if (characteristic.UUID == (new Characteristic.TimeInterval()).UUID) {
					this.command("setTime", value + Math.trunc((new Date()).getTime() / 1000), service, IDs);
				} else if (characteristic.UUID == (new Characteristic.TargetHeatingCoolingState()).UUID) {
					this.command("TargetHeatingCoolingState", value, service, IDs);
				} else if (characteristic.UUID == (new Characteristic.LockTargetState()).UUID) {
					var action = value == Characteristic.LockTargetState.UNSECURED ? "unsecure" : "secure";
					this.command(action, 0, service, IDs);
				} else if (characteristic.UUID == (new Characteristic.Hue()).UUID) {
					var rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
					this.syncColorCharacteristics(rgb, service, IDs);
				} else if (characteristic.UUID == (new Characteristic.Saturation()).UUID) {
					var rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
					this.syncColorCharacteristics(rgb, service, IDs);
				} else if (characteristic.UUID == (new Characteristic.Brightness()).UUID) {
					if (service.HSBValue != null) {
						var rgb = this.updateJeedomColorFromHomeKit(null, null, value, service);
						this.syncColorCharacteristics(rgb, service, IDs);
					} else {
						this.command("setValue", value, service, IDs);
					}
				} else {
					this.command("setValue", value, service, IDs);
				}
			}
			callback();
		}.bind(this));
	}
	characteristic.on('get', function(callback) {
		if (service.isVirtual) {
			callback(undefined, false);
		} else {
			this.getAccessoryValue(callback, onOff, characteristic, service, IDs);
		}
	}.bind(this));
};
JeedomPlatform.prototype.getAccessoryValue = function(callback, returnBoolean, characteristic, service, IDs) {
	var that = this;
	var cmds = IDs[1].split("|");
	this.jeedomClient.getDeviceCmd(IDs[0]).then(function(properties) {
		if (characteristic.UUID == (new Characteristic.OutletInUse()).UUID) {
			callback(undefined, parseFloat(properties.power) > 1.0 ? true : false);
		} else if (characteristic.UUID == (new Characteristic.TimeInterval()).UUID) {
			var t = (new Date()).getTime();
			t = parseInt(properties.timestamp) - t;
			if (t < 0)
				t = 0;
			callback(undefined, t);
		} else if (characteristic.UUID == (new Characteristic.TargetTemperature()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "THERMOSTAT_SETPOINT") {
					v = parseInt(element.currentValue);
					//console.log("valeur " + element.generic_type + " : " + v);
				}
			});
			callback(undefined, v);
		} else if (characteristic.UUID == (new Characteristic.Hue()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "LIGHT_COLOR") {
					//console.log("valeur " + element.generic_type + " : " + v);
					v = element.currentValue;
				}
			});
			var hsv = that.updateHomeKitColorFromJeedom(v, service);
			callback(undefined, Math.round(hsv.h));
		} else if (characteristic.UUID == (new Characteristic.Saturation()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "LIGHT_COLOR") {
					//console.log("valeur " + element.generic_type + " : " + v);
					v = element.currentValue;
				}
			});
			var hsv = that.updateHomeKitColorFromJeedom(v, service);
			callback(undefined, Math.round(hsv.s));
		} else if (characteristic.UUID == (new Characteristic.SmokeDetected()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "SMOKE" && element.id == cmds[0]) {
					v = parseInt(element.currentValue);
					//console.log("valeur " + element.generic_type + " : " + v);
				}
			});
			callback(undefined, v == 1 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED);
		} else if (characteristic.UUID == (new Characteristic.LeakDetected()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "FLOOD" && element.id == cmds[0]) {
					v = parseInt(element.currentValue);
					//console.log("valeur " + element.generic_type + " : " + v);
				}
			});
			callback(undefined, v == 1 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED);
		} else if (characteristic.UUID == (new Characteristic.ContactSensorState()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "OPENING" && element.id == cmds[0]) {
					v = parseInt(element.currentValue);
					//console.log("valeur " + element.generic_type + " : " + v);
				}
			});
			callback(undefined, v == 1 ? Characteristic.ContactSensorState.CONTACT_NOT_DETECTED : Characteristic.ContactSensorState.CONTACT_DETECTED);
		} else if (characteristic.UUID == (new Characteristic.Brightness()).UUID) {
			if (service.HSBValue != null) {
				var v = "";
				properties.forEach(function(element, index, array) {
					if (element.generic_type == "LIGHT_COLOR") {
						//console.log("valeur " + element.generic_type + " : " + v);
						v = element.currentValue;
					}
				});
				var hsv = that.updateHomeKitColorFromJeedom(v, service);
				callback(undefined, Math.round(hsv.v));
			} else {
				var v = "";
				properties.forEach(function(element, index, array) {
					if (element.generic_type == "LIGHT_STATE" && element.id == cmds[0]) {
						if (v == "")
							v = 0;
						v = parseInt(element.currentValue);
						//console.log("valeur " + element.generic_type + " : " + v);
					}
				});
				callback(undefined, v);
			}
		} else if (characteristic.UUID == (new Characteristic.SecuritySystemCurrentState()).UUID) {
			var v = 0;
			var alarm = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "ALARM_ENABLE_STATE") {
					if (parseInt(element.currentValue) == 0) {
						//console.log("valeur " + element.generic_type + " : desarmé");
						v = Characteristic.SecuritySystemCurrentState.DISARMED;
					} else {
						//console.log("valeur " + element.generic_type + " : armé");
						v = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
					}
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
				}
				if (element.generic_type == "ALARM_STATE") {
					if (parseInt(element.currentValue) == 1) {
						//console.log("valeur " + element.generic_type + " : alarm");
						alarm = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
					}
				}
			});
			if (alarm != 0) {
				callback(undefined, alarm);
			} else {
				callback(undefined, v);
			}

		} else if (characteristic.UUID == (new Characteristic.SecuritySystemTargetState()).UUID) {
			var v = 0;
			var alarm = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "ALARM_ENABLE_STATE") {
					if (parseInt(element.currentValue) == 0) {
						//console.log("valeur " + element.generic_type + " : desarmé");
						v = Characteristic.SecuritySystemCurrentState.DISARMED;
					} else {
						//console.log("valeur " + element.generic_type + " : armé");
						v = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
					}
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
				}
				if (element.generic_type == "ALARM_STATE") {
					if (parseInt(element.currentValue) == 1) {
						//console.log("valeur " + element.generic_type + " : alarm");
						alarm = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
					}
				}
			});
			if (alarm != 0) {
				callback(undefined, alarm);
			} else {
				callback(undefined, v);
			}

		} else if (characteristic.UUID == (new Characteristic.CurrentHeatingCoolingState()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "THERMOSTAT_MODE") {
					if (element.currentValue == "Off") {
						v = Characteristic.CurrentHeatingCoolingState.OFF;
					} else {
						v = Characteristic.CurrentHeatingCoolingState.AUTO;
					}
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
				}
			});
			callback(undefined, v);
		} else if (characteristic.UUID == (new Characteristic.PositionState()).UUID) {
			callback(undefined, Characteristic.PositionState.STOPPED);
		} else if (characteristic.UUID == (new Characteristic.LockCurrentState()).UUID || characteristic.UUID == (new Characteristic.LockTargetState()).UUID) {
			callback(undefined, properties.value == "true" ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED);
		} else if (characteristic.UUID == (new Characteristic.CurrentPosition()).UUID || characteristic.UUID == (new Characteristic.TargetPosition()).UUID) {
			var v = "";
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "FLAP_STATE" && element.id == cmds[0]) {
					v = parseInt(element.currentValue);
					//console.log("valeur " + element.generic_type + " : " + v);
				}
			});
			callback(undefined, v);
		} else if (returnBoolean) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if ((element.generic_type == "LIGHT_STATE" && element.id == cmds[0]) || (element.generic_type == "ENERGY_STATE" && element.id == cmds[0]) || (element.generic_type == "PRESENCE" && element.id == cmds[0]) || (element.generic_type == "OPENING" && element.id == cmds[0])) {
					v = element.currentValue;
					//console.log("valeur binary " + element.generic_type + " : " + v);
				}
			});

			//var v = properties.value;
			if (v == "true" || v == "false") {
				callback(undefined, (v == "false") ? false : true);
			} else {
				callback(undefined, (parseInt(v) == 0) ? false : true);
			}
		} else if (characteristic.UUID == (new Characteristic.CurrentTemperature()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if ((element.generic_type == "TEMPERATURE" && element.id == cmds[0]) || element.generic_type == "THERMOSTAT_TEMPERATURE") {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseFloat(v));
		} else if (characteristic.UUID == (new Characteristic.CurrentAmbientLightLevel()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "BRIGHTNESS" && element.id == cmds[0]) {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseInt(v));
		} else if (characteristic.UUID == (new Characteristic.CurrentRelativeHumidity()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "HUMIDITY" && element.id == cmds[0]) {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseInt(v));
		} else if (characteristic.UUID == (new Characteristic.BatteryLevel()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "BATTERY" && element.id == cmds[0]) {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseInt(v));
		} else if (characteristic.UUID == (new Characteristic.CurrentPowerConsumption()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "POWER" && element.id == cmds[0]) {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseFloat(v));
		} else if (characteristic.UUID == (new Characteristic.TotalPowerConsumption()).UUID) {
			var v = 0;
			properties.forEach(function(element, index, array) {
				if (element.generic_type == "CONSUMPTION" && element.id == cmds[0]) {
					//console.log("valeur " + element.generic_type + " : " + element.currentValue);
					v = element.currentValue;
				}
			});
			callback(undefined, parseFloat(v));
		} else {
			var v = 0;
			callback(undefined, parseInt(v));
		}
	}).catch(function(err, response) {
		that.log("There was a problem getting value from" + IDs[0] + "-" + err);
	});
};
JeedomPlatform.prototype.command = function(c, value, service, IDs) {
	var that = this;
	var cmds = IDs[1].split("|");
	if (service.UUID == (new Service.SecuritySystem()).UUID) {
		c = "SetAlarmMode";
	} else if (value == 0 && service.UUID == (new Service.WindowCovering).UUID) {
		c = "flapDown";
	} else if ((value == 99 || value == 100) && service.UUID == (new Service.WindowCovering).UUID) {
		c = "flapUp";
	}
	this.jeedomClient.getDeviceCmd(IDs[0]).then(function(resultCMD) {
		var cmdId = cmds[0];
		resultCMD.forEach(function(element, index, array) {
			if (c == "flapDown" && element.generic_type == "FLAP_DOWN") {
				cmdId = element.id;
			} else if (c == "flapUp" && element.generic_type == "FLAP_UP") {
				cmdId = element.id;
			} else if (value >= 0 && element.id == cmds[3] && (element.generic_type == "LIGHT_SLIDER" || element.generic_type == "FLAP_SLIDER")) {
				cmdId = element.id;
				if (value == undefined) {
					if (c == "turnOn") {
						value = 99;
					} else if (c == "turnOff") {
						value = 0;
					}
				}
			} else if ((value == 255 || c == "turnOn") && element.id == cmds[1] && (element.generic_type == "LIGHT_ON" || element.generic_type == "ENERGY_ON")) {
				cmdId = element.id;
			} else if ((value == 0 || c == "turnOff") && element.id == cmds[2] && (element.generic_type == "LIGHT_OFF" || (element.generic_type == "ENERGY_OFF" && element.id == cmds[2]) )) {
				cmdId = element.id;
			} else if (c == "setRGB" && element.generic_type == "LIGHT_SET_COLOR") {
				cmdId = element.id;
			} else if (c == "SetAlarmMode" && element.generic_type == "ALARM_ARMED" && value < 3) {
				cmdId = element.id;
			} else if (c == "SetAlarmMode" && element.generic_type == "ALARM_RELEASED" && value == 3) {
				cmdId = element.id;
			} else if (c == "setTargetLevel" && value > 0 && element.generic_type == "THERMOSTAT_SET_SETPOINT") {
				cmdId = element.id;
			} else if (c == "TargetHeatingCoolingState") {
				if (element.generic_type == "THERMOSTAT_SET_MODE" && element.name == "Off") {
					cmdId = element.id;
				}
			}
		});
		that.jeedomClient.executeDeviceAction(cmdId, c, value).then(function(response) {
			that.log("Command: " + c + ((value != undefined) ? ", value: " + value : ""));
		}).catch(function(err, response) {
			that.log("There was a problem sending command " + c + " to " + IDs[0]);
		});
	}).catch(function(err, response) {
		that.log("#1 Error getting data from Jeedom: " + err + " " + response);
	});
};
JeedomPlatform.prototype.subscribeUpdate = function(service, characteristic, onOff, propertyChanged) {
	if (characteristic.UUID == (new Characteristic.PositionState()).UUID)
		return;

	var IDs = service.subtype.split("-");
	this.updateSubscriptions.push({
		'id' : IDs[0],
		'service' : service,
		'characteristic' : characteristic,
		'onOff' : onOff,
		"property" : propertyChanged
	});
};
JeedomPlatform.prototype.startPollingUpdate = function(lastPoll) {
	var that = this;
	if (this.jeedomClient == undefined) {
		setTimeout(function() {
			that.startPollingUpdate(0);
		}, that.pollerPeriod * 1000);
		return;
	}
	that.lastPoll = lastPoll;
	this.jeedomClient.refreshStates(this.lastPoll).then(function(updates) {
		if (updates.result != undefined) {
			var lastPoll = updates.datetime;
		}
		if (updates.result != undefined) {
			updates.result.map(function(s) {
				if (s.option.value != undefined && s.option.cmd_id != undefined) {
					var value = parseInt(s.option.value);
					if (isNaN(value))
						value = (s.option.value === "true");
					for (var i = 0; i < that.updateSubscriptions.length; i++) {
						var subscription = that.updateSubscriptions[i];
						if (subscription.service.subtype != undefined) {
							var IDs = subscription.service.subtype.split("-");
							var cmds = IDs[1].split("|");
							var cmd_id = cmds[0];
							var cmd2_id = IDs[2];
						}
						if (cmd_id == s.option.cmd_id || cmd2_id == s.option.cmd_id) {
							var powerValue = false;
							var intervalValue = false;
							if (subscription.characteristic.UUID == (new Characteristic.OutletInUse()).UUID)
								powerValue = true;
							if (subscription.characteristic.UUID == (new Characteristic.TimeInterval()).UUID)
								intervalValue = true;
							if (subscription.characteristic.UUID == (new Characteristic.SmokeDetected()).UUID)
								subscription.characteristic.setValue(value == 0 ? Characteristic.SmokeDetected.SMOKE_DETECTED : Characteristic.SmokeDetected.SMOKE_NOT_DETECTED, undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.SecuritySystemCurrentState()).UUID) {
								if (cmd2_id == s.option.cmd_id && value == 1) {
									subscription.characteristic.setValue(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED, undefined, 'fromJeedom');
								} else {
									subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
								}
							} else if (subscription.characteristic.UUID == (new Characteristic.SecuritySystemTargetState()).UUID) {
								subscription.characteristic.setValue(value == 0 ? Characteristic.SecuritySystemCurrentState.DISARMED : Characteristic.SecuritySystemCurrentState.ARM_AWAY, undefined, 'fromJeedom');
							} else if (subscription.characteristic.UUID == (new Characteristic.LeakDetected()).UUID)
								subscription.characteristic.setValue(value == 0 ? Characteristic.LeakDetected.LEAK_DETECTED : Characteristic.LeakDetected.LEAK_NOT_DETECTED, undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.ContactSensorState()).UUID)
								subscription.characteristic.setValue(value == 0 ? Characteristic.ContactSensorState.CONTACT_DETECTED : Characteristic.ContactSensorState.CONTACT_NOT_DETECTED, undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.LockCurrentState()).UUID || subscription.characteristic.UUID == (new Characteristic.LockTargetState()).UUID)
								subscription.characteristic.setValue(value == 1 ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED, undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.CurrentPosition()).UUID || subscription.characteristic.UUID == (new Characteristic.TargetPosition()).UUID) {
								if (value >= subscription.characteristic.props.minValue && value <= subscription.characteristic.props.maxValue)
									subscription.characteristic.setValue(value, undefined, 'fromJeedom');
							} else if (s.power != undefined && powerValue) {
								subscription.characteristic.setValue(parseFloat(s.power) > 1.0 ? true : false, undefined, 'fromJeedom');
							} else if ((subscription.onOff && typeof (value) == "boolean") || !subscription.onOff) {
								subscription.characteristic.setValue(value, undefined, 'fromJeedom');
							} else {
								subscription.characteristic.setValue(value == 0 ? false : true, undefined, 'fromJeedom');
							}
						}
					}
				}
				if (s.color != undefined) {
					for (var i = 0; i < that.updateSubscriptions.length; i++) {
						var subscription = that.updateSubscriptions[i];
						if (subscription.id == s.id && subscription.property == "color") {
							var hsv = that.updateHomeKitColorFromJeedom(s.color, subscription.service);
							if (subscription.characteristic.UUID == (new Characteristic.On()).UUID)
								subscription.characteristic.setValue(hsv.v == 0 ? false : true, undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.Hue()).UUID)
								subscription.characteristic.setValue(Math.round(hsv.h), undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.Saturation()).UUID)
								subscription.characteristic.setValue(Math.round(hsv.s), undefined, 'fromJeedom');
							else if (subscription.characteristic.UUID == (new Characteristic.Brightness()).UUID)
								subscription.characteristic.setValue(Math.round(hsv.v), undefined, 'fromJeedom');
						}
					}
				}
			});

		}
		that.startPollingUpdate(lastPoll);
	}).catch(function(err, response) {
		that.log("Error fetching updates: " + err);
	});
};
JeedomPlatform.prototype.updateJeedomColorFromHomeKit = function(h, s, v, service) {
	if (h != null)
		service.HSBValue.hue = h;
	if (s != null)
		service.HSBValue.saturation = s;
	if (v != null)
		service.HSBValue.brightness = v;
	var rgb = HSVtoRGB(service.HSBValue.hue, service.HSBValue.saturation, service.HSBValue.brightness);
	service.RGBValue.red = rgb.r;
	service.RGBValue.green = rgb.g;
	service.RGBValue.blue = rgb.b;
	return rgb;
};
JeedomPlatform.prototype.updateHomeKitColorFromJeedom = function(color, service) {
	if (color == undefined)
		color = "0,0,0";
	//console.log("couleur :" + color);
	var colors = color.split(",");
	var r = hexToR(color);
	var g = hexToG(color);
	var b = hexToB(color);
	service.RGBValue.red = r;
	service.RGBValue.green = g;
	service.RGBValue.blue = b;
	var hsv = RGBtoHSV(r, g, b);
	service.HSBValue.hue = hsv.h;
	service.HSBValue.saturation = hsv.s;
	service.HSBValue.brightness = hsv.v;
	return hsv;
};

JeedomPlatform.prototype.syncColorCharacteristics = function(rgb, service, IDs) {
	switch (--service.countColorCharacteristics) {
	case -1:
		service.countColorCharacteristics = 2;
		var that = this;
		service.timeoutIdColorCharacteristics = setTimeout(function() {
			if (service.countColorCharacteristics < 2)
				return;
			var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
			that.command("setRGB", rgbColor, service, IDs);
			service.countColorCharacteristics = 0;
			service.timeoutIdColorCharacteristics = 0;
		}, 1000);
		break;
	case 0:
		var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
		this.command("setRGB", rgbColor, service, IDs);
		service.countColorCharacteristics = 0;
		service.timeoutIdColorCharacteristics = 0;
		break;
	default:
		break;
	}
};
function JeedomBridgedAccessory(services) {
	this.services = services;
}

JeedomBridgedAccessory.prototype.initAccessory = function(newAccessory) {
	newAccessory.getService(Service.AccessoryInformation).setCharacteristic(Characteristic.Manufacturer, this.manufacturer).setCharacteristic(Characteristic.Model, this.model).setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

	for (var s = 0; s < this.services.length; s++) {
		var service = this.services[s];
		newAccessory.addService(service.controlService);
		for (var i = 0; i < service.characteristics.length; i++) {
			var characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
			characteristic.props.needsBinding = true;
			if (characteristic.UUID == (new Characteristic.CurrentAmbientLightLevel()).UUID) {
				characteristic.props.maxValue = 1000;
				characteristic.props.minStep = 1;
				characteristic.props.minValue = 1;
			}
			this.platform.bindCharacteristicEvents(characteristic, service.controlService);
		}
	}
};
function hexToR(h) {
	return parseInt((cutHex(h)).substring(0, 2), 16);
}

function hexToG(h) {
	return parseInt((cutHex(h)).substring(2, 4), 16);
}

function hexToB(h) {
	return parseInt((cutHex(h)).substring(4, 6), 16);
}

function cutHex(h) {
	return (h.charAt(0) == "#") ? h.substring(1, 7) : h;
}

function rgbToHex(R, G, B) {
	return "#" + toHex(R) + toHex(G) + toHex(B);
}

function toHex(n) {
	n = parseInt(n, 10);
	if (isNaN(n))
		return "00";
	n = Math.max(0, Math.min(n, 255));
	return "0123456789ABCDEF".charAt((n - n % 16) / 16) + "0123456789ABCDEF".charAt(n % 16);
}

function HSVtoRGB(hue, saturation, value) {
	var h = hue / 360.0;
	var s = saturation / 100.0;
	var v = value / 100.0;
	var r, g, b, i, f, p, q, t;
	if (arguments.length === 1) {
		s = h.s, v = h.v, h = h.h;
	}
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
	case 0:
		r = v, g = t, b = p;
		break;
	case 1:
		r = q, g = v, b = p;
		break;
	case 2:
		r = p, g = v, b = t;
		break;
	case 3:
		r = p, g = q, b = v;
		break;
	case 4:
		r = t, g = p, b = v;
		break;
	case 5:
		r = v, g = p, b = q;
		break;
	}
	return {
		r : Math.round(r * 255),
		g : Math.round(g * 255),
		b : Math.round(b * 255)
	};
}

function RGBtoHSV(r, g, b) {
	if (arguments.length === 1) {
		g = r.g, b = r.b, r = r.r;
	}
	var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h, s = (max === 0 ? 0 : d / max), v = max / 255;

	switch (max) {
	case min:
		h = 0;
		break;
	case r:
		h = (g - b) + d * (g < b ? 6 : 0);
		h /= 6 * d;
		break;
	case g:
		h = (b - r) + d * 2;
		h /= 6 * d;
		break;
	case b:
		h = (r - g) + d * 4;
		h /= 6 * d;
		break;
	}

	return {
		h : h * 360.0,
		s : s * 100.0,
		v : v * 100.0
	};
}
