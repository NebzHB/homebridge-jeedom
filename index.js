/* This file is part of Jeedom.
 *
 * Jeedom is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * Jeedom is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Jeedom. If not, see <http://www.gnu.org/licenses/>.
 */
/*jshint esversion: 6,node: true */
'use strict';

var Accessory, Service, Characteristic, UUIDGen;
var inherits = require('util').inherits;
var myLogger = require('./lib/myLogger').myLogger;
var debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARN = 300;
debug.ERROR = 400;
debug.NO = 1000;
var hasError = false;
const DEV_DEBUG=false;

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	UUIDGen = homebridge.hap.uuid;
	RegisterCustomCharacteristics();
	homebridge.registerPlatform('homebridge-jeedom', 'Jeedom', JeedomPlatform, true);
};

// -- JeedomPlatform
// -- Desc : Main Class, used by Homebridge to construct the platform object
// -- Params --
// -- logger : homebridge logger object, contain a prefix
// -- config : homebridge's config.json file object
// -- api : homebridge api
// -- Return : nothing
function JeedomPlatform(logger, config, api) {
	try{
		this.config = config || {};
		this.accessories = [];
		this.debugLevel = config.debugLevel || debug.ERROR;
		this.alarms = config.alarms || [];
		this.log = myLogger.createMyLogger(this.debugLevel,logger);
		this.log('debugLevel:'+this.debugLevel);
		
		if (!config.url || 
		    config.url == "http://:80" ||
			config.url == 'https://:80') {
			this.log('error',"Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
			process.exit(1);
		}else{
			this.log('info',"Adresse Jeedom bien configurée :"+config.url);	
		}
		this.jeedomClient = require('./lib/jeedom-api').createClient(config.url, config.apikey, this);
		this.rooms = {};
		this.updateSubscriptions = [];
		
		this.lastPoll = 0;
		this.pollingUpdateRunning = false;
		this.pollingID = null;
		
		this.pollerPeriod = config.pollerperiod;
		if ( typeof this.pollerPeriod == 'string')
			this.pollerPeriod = parseInt(this.pollerPeriod);
		else if (!this.pollerPeriod)
			this.pollerPeriod = 0.5; // 0.5 is Nice between 2 calls
		
		if (api) {
			this.api = api;
			this.api.on('didFinishLaunching',function(){
				this.addAccessories();
			}.bind(this));
		}
	}
	catch (e) {
		this.log('error','Erreur de la Fonction JeedomPlatform : ',e);	
		console.error(e.stack);
	}
}

// -- addAccessories
// -- Desc : Accessories creation, we get a full model from jeedom and put it in local cache
// -- Return : nothing
JeedomPlatform.prototype.addAccessories = function() {
	try{
		var that = this;
		that.log('Synchronisation Jeedom <> Homebridge...');
		that.jeedomClient.getModel()
			.then(function(model){ // we got the base Model from the API
				if(!model) that.log('error','Model invalide > ',model);
				that.lastPoll=model.config.datetime;
				that.log('Enumération des objets Jeedom (Pièces)...');
				model.objects.map(function(r){
					that.rooms[r.id] = r.name;
					that.log('Pièce > ' + r.name);
				});
			
				that.log('Enumération des périphériques Jeedom...');
				if(model.eqLogics == null) that.log('error','Périf > '+model.eqLogics);
				that.JeedomDevices2HomeKitAccessories(model.eqLogics);
			}).catch(function(err, response) {
				that.log('error','#2 Erreur de récupération des données Jeedom: ' , err , ' (' + response + ')');
				console.error(err.stack);
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction addAccessories :',e);
		console.error(e.stack);
	}
};

// -- JeedomDevices2HomeKitAccessories
// -- Desc : Translate JeedomDevices into Homebridge Accessories
// -- Params --
// -- devices : eqLogics from jeedom
// -- Return : nothing
JeedomPlatform.prototype.JeedomDevices2HomeKitAccessories = function(devices) {
	try{
		var that = this;
		if (devices) {
			devices.sort(function compare(a, b) {
				// reorder by room name asc and name asc
				var aC = that.rooms[a.object_id]+a.name;
				var bC = that.rooms[b.object_id]+b.name;
				if (aC > bC) {
					return 1;
				}
				if (aC < bC) {
					return -1;
				}
				return 0;
			});
			
			devices.map(function(device) {
				if (device.isVisible == '1' && 
				    device.object_id != null && 
				    device.sendToHomebridge != '0') { // we dont receive not visible and empty room, so the only test here is sendToHomebridge

					that.AccessoireCreateHomebridge(
						that.jeedomClient.ParseGenericType(
							device, 
							that.jeedomClient.getDeviceCmd(device.id)
						)
					);
				}
				else
				{
					that.log('┌──── ' + that.rooms[device.object_id] + ' > ' +device.name+' ('+device.id+')');
					var Messg= '│ Accessoire ';
					Messg   += device.isVisible == '1' ? 'visible' : 'invisible';
					Messg   += device.object_id != null ? '' : ', pas dans une pièce';
					Messg   += device.sendToHomebridge != '0' ? '' : ', pas coché pour Homebridge';
					that.log(Messg);

					that.delAccessory(
						that.createAccessory([], device) // create a cached lookalike object for unregistering it
					);
					that.log('└─────────');
				}
				
			});
		}
		var countA=0;
		if(!hasError)
		{
			that.log('┌────RAMASSE-MIETTES─────');
			that.log('│ (Suppression des accessoires qui sont dans le cache mais plus dans jeedom (peut provenir de renommage ou changement de pièce))');
			var hasDeleted = false;
			for (var a in that.accessories) 
			{
				if (that.accessories.hasOwnProperty(a)) {
					if(!that.accessories[a].reviewed && 
					   that.accessories[a].displayName) {
						that.log('│ ┌──── Trouvé: '+that.accessories[a].displayName);
						that.delAccessory(that.accessories[a],true);
						that.log('│ │ Supprimé du cache !');
						that.log('│ └─────────');
						hasDeleted=true;
					}else if(that.accessories[a].reviewed && 
						 that.accessories[a].displayName) countA++;
				}
			}
			if(!hasDeleted) that.log('│ Rien à supprimer');
			that.log('└────────────────────────');
		}
		else
		{
			that.log('error','!!! ERREUR DETECTÉE, ON QUITTE HOMEBRIDGE !!!');
			process.exit(1);
		}
		var endLog = '--== Homebridge est démarré et a intégré '+countA+' accessoire'+ (countA>1 ? 's' : '') +' ! (Si vous avez un Warning Avahi, ne pas en tenir compte) ==--';
		that.log(endLog);
		if(countA >= 100) that.log('error','!!! ATTENTION !!! Vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 100 max au total !!');
		else if(countA >= 90) that.log('warn','!! Avertissement, vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 100 max au total !!');
		
		that.log('debug','==START POLLING==');
		that.startPollingUpdate();
	}
	catch(e){
		this.log('error','Erreur de la fonction JeedomDevices2HomeKitAccessories :',e);
		console.error(e.stack);
	}
};

// -- AccessoireCreateHomebridge
// -- Desc : Prepare the service list
// -- Params --
// -- eqLogic : eqLogics from jeedom (and cmd's)
// -- Return : nothing
JeedomPlatform.prototype.AccessoireCreateHomebridge = function(eqLogic) {
	var createdAccessory;
	try {
		var that = this;
		var HBservices = [];
		var HBservice = null;	
		var eqServicesCopy = eqLogic.services;
		that.log('debug','eqLogic > '+JSON.stringify(eqLogic).replace("\n",''));
		that.log('┌──── ' + that.rooms[eqLogic.object_id] + ' > ' + eqLogic.name + ' (' + eqLogic.id + ')');
		if (eqLogic.services.light) {
			eqLogic.services.light.forEach(function(cmd) {
				if (cmd.color) { // don't work fine
					HBservice = {
						controlService : new Service.Lightbulb(eqLogic.name),
						characteristics : [Characteristic.On, Characteristic.Brightness, Characteristic.Hue, Characteristic.Saturation]
					};
					HBservice.controlService.cmd_id = cmd.color.id;
					HBservice.controlService.HSBValue = {
						hue : 0,
						saturation : 0,
						brightness : 0
					};
					HBservice.controlService.RGBValue = {
						red : 0,
						green : 0,
						blue : 0
					};
					HBservice.controlService.countColorCharacteristics = 0;
					HBservice.controlService.timeoutIdColorCharacteristics = 0;
					HBservice.controlService.subtype = 'RGB';
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.color.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
				} else if (cmd.state) {
					var cmd_on = 0;
					var cmd_off = 0;
					var cmd_slider = 0;
					eqServicesCopy.light.forEach(function(cmd2) {
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
						HBservice = {
							controlService : new Service.Lightbulb(eqLogic.name),
							characteristics : [Characteristic.On]
						};
					} else {
						HBservice = {
							controlService : new Service.Lightbulb(eqLogic.name),
							characteristics : [Characteristic.On, Characteristic.Brightness]
						};
					}
					HBservice.controlService.cmd_id = eqLogic.services.light.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '|' + cmd_slider + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Lumière Etat" ou "Info/Lumière Couleur"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.flap) {
			eqLogic.services.flap.forEach(function(cmd) {
				if (cmd.state) {
					var cmd_up = 0;
					var cmd_down = 0;
					var cmd_slider = 0;
					eqServicesCopy.flap.forEach(function(cmd2) {
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
						}
					});
					if (cmd_up && !cmd_down) that.log('warn','Pas de type générique "Action/Volet Bouton Descendre" ou reférence à l\'état non définie sur la commande Up'); 
					if (!cmd_up && cmd_down) that.log('warn','Pas de type générique "Action/Volet Bouton Monter" ou reférence à l\'état non définie sur la commande Up');
					if(!cmd_up && !cmd_down && !cmd_slider) that.log('warn','Pas de type générique "Action/Volet Bouton Slider" ou "Action/Volet Bouton Monter" et "Action/Volet Bouton Descendre" ou reférence à l\'état non définie sur la commande Slider');
					HBservice = {
						controlService : new Service.WindowCovering(eqLogic.name),
						characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState]
					};
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '|' + cmd_down + '|' + cmd_up + '|' + cmd_slider + '-' + HBservice.controlService.subtype;

					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Volet Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.energy) {
			eqLogic.services.energy.forEach(function(cmd) {
				if (cmd.state) {
					var cmd_on = 0;
					var cmd_off = 0;
					eqServicesCopy.energy.forEach(function(cmd2) {
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
					if(!cmd_on) that.log('warn','Pas de type générique "Action/Prise Bouton On" ou reférence à l\'état non définie sur la commande On');
					if(!cmd_off) that.log('warn','Pas de type générique "Action/Prise Bouton Off" ou reférence à l\'état non définie sur la commande Off');
					HBservice = {
						controlService : new Service.Switch(eqLogic.name),
						characteristics : [Characteristic.On]
					};
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Prise Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.power || (eqLogic.services.power && eqLogic.services.consumption)) {
			eqLogic.services.power.forEach(function(cmd) {
				if (cmd.power) {
					HBservice = {
						controlService : new Service.PowerMonitor(eqLogic.name),
						characteristics : [Characteristic.CurrentPowerConsumption, Characteristic.TotalPowerConsumption]
					};
					var cmd_id_consumption=0;
					if(eqServicesCopy.consumption) {
						eqServicesCopy.consumption.forEach(function(cmd2) {
							if (cmd2.consumption) {
								cmd_id_consumption = cmd2.consumption.id;
							}
						});
					}
					var cmd_id_power = cmd.power.id;
					
					HBservice.controlService.cmd_id = cmd_id_power;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd_id_power + '|' + cmd_id_consumption + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.battery) {
			eqLogic.services.battery.forEach(function(cmd) {
				if (cmd.battery) {
					HBservice = {
						controlService : new Service.BatteryService(eqLogic.name),
						characteristics : [Characteristic.BatteryLevel,Characteristic.ChargingState,Characteristic.StatusLowBattery]
					};
					var cmd_charging='NOT';
					if (cmd.batteryCharging)
						cmd_charging = cmd.batteryCharging.id;
					HBservice.controlService.cmd_id = cmd.battery.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.battery.id +'|'+ cmd_charging + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.presence) {
			eqLogic.services.presence.forEach(function(cmd) {
				if (cmd.presence) {
					HBservice = {
						controlService : new Service.MotionSensor(eqLogic.name),
						characteristics : [Characteristic.MotionDetected]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.presence.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.presence.id + '|' + cmd.presence.display.invertBinary + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.generic) {
			eqLogic.services.generic.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.NotificationService(eqLogic.name),
						characteristics : [Characteristic.Name,/*Characteristic.NotificationCode,*/Characteristic.NotificationText]
					};
					HBservice.controlService.getCharacteristic(Characteristic.NotificationText).displayName = cmd.state.name;
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					var unite = cmd.state.unite ? cmd.state.unite : '';
					var props={};
					if(unite) {
						props.unit=unite;
						HBservice.controlService.getCharacteristic(Characteristic.NotificationText).setProps(props);
					}
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id +'-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.uv) {
			eqLogic.services.uv.forEach(function(cmd) {
				if (cmd.uv) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.UVIndex]
					};
					HBservice.controlService.cmd_id = cmd.uv.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.uv.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}						
		if (eqLogic.services.temperature) {
			eqLogic.services.temperature.forEach(function(cmd) {
				if (cmd.temperature) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.temperature.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.temperature.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});

		}
		if (eqLogic.services.humidity) {
			eqLogic.services.humidity.forEach(function(cmd) {
				if (cmd.humidity) {
					HBservice = {
						controlService : new Service.HumiditySensor(eqLogic.name),
						characteristics : [Characteristic.CurrentRelativeHumidity]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.humidity.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.humidity.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.smoke) {
			eqLogic.services.smoke.forEach(function(cmd) {
				if (cmd.smoke) {
					HBservice = {
						controlService : new Service.SmokeSensor(eqLogic.name),
						characteristics : [Characteristic.SmokeDetected]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.smoke.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.smoke.id + '|' + cmd.smoke.display.invertBinary + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.flood) {
			eqLogic.services.flood.forEach(function(cmd) {
				if (cmd.flood) {
					HBservice = {
						controlService : new Service.LeakSensor(eqLogic.name),
						characteristics : [Characteristic.LeakDetected]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.flood.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.flood.id + '|' + cmd.flood.display.invertBinary + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.opening) {
			eqLogic.services.opening.forEach(function(cmd) {
				if (cmd.opening) {
					HBservice = {
						controlService : new Service.ContactSensor(eqLogic.name),
						characteristics : [Characteristic.ContactSensorState]
					};
					HBservice.controlService.cmd_id = cmd.opening.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.opening.id + '|' + cmd.opening.display.invertBinary + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.brightness) {
			eqLogic.services.brightness.forEach(function(cmd) {
				if (cmd.brightness) {
					HBservice = {
						controlService : new Service.LightSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentAmbientLightLevel]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.brightness.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.brightness.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.energy2) { // not used
			HBservice = {
				controlService : new Service.Outlet(eqLogic.name),
				characteristics : [Characteristic.On, Characteristic.OutletInUse]
			};
			if (!HBservice.controlService.subtype)
				HBservice.controlService.subtype = '';
			HBservice.controlService.subtype = eqLogic.id + '-' + eqLogic.services.brightness.id + '-' + HBservice.controlService.subtype;
			HBservices.push(HBservice);
			HBservice = null;
		}
		if (eqLogic.services.GarageDoor) {
			eqLogic.services.GarageDoor.forEach(function(cmd) {
				if (cmd.state) {
					var cmd_on = 0;
					var cmd_off = 0;
					var cmd_toggle = 0;
					eqServicesCopy.GarageDoor.forEach(function(cmd2) {
						if (cmd2.on) {
							if (cmd2.on.value == cmd.state.id) {
								cmd_on = cmd2.on.id;
							}
						} else if (cmd2.off) {
							if (cmd2.off.value == cmd.state.id) {
								cmd_off = cmd2.off.id;
							}
						} else if (cmd2.toggle) {
							if (cmd2.toggle.value == cmd.state.id) {
								cmd_toggle = cmd2.toggle.id;
							}
						}
					});
					if(!cmd_toggle) that.log('warn','Pas de type générique "Action/Portail ou garage bouton toggle" ou reférence à l\'état non définie sur la commande Toggle');
					HBservice = {
						controlService : new Service.GarageDoorOpener(eqLogic.name),
						characteristics : [Characteristic.CurrentDoorState, Characteristic.TargetDoorState]//, Characteristic.ObstructionDetected]
					};
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Garage état ouvrant" ou "Info/Portail état ouvrant"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.lock) {
			eqLogic.services.lock.forEach(function(cmd) {
				if (cmd.state) {
					var cmd_on = 0;
					var cmd_off = 0;
					eqServicesCopy.lock.forEach(function(cmd2) {
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
					if(!cmd_on) that.log('warn','Pas de type générique "Action/Serrure Bouton Ouvrir" ou reférence à l\'état non définie sur la commande On');
					if(!cmd_off) that.log('warn','Pas de type générique "Action/Serrure Bouton Fermer" ou reférence à l\'état non définie sur la commande Off');
					HBservice = {
						controlService : new Service.LockMechanism(eqLogic.name),
						characteristics : [Characteristic.LockCurrentState, Characteristic.LockTargetState]
					};
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '|' + cmd_on + '|' + cmd_off + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Serrure Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.DoorBell) {
			eqLogic.services.DoorBell.forEach(function(cmd) {
				if(cmd.state) {
					HBservice = {
						controlService : new Service.Doorbell(eqLogic.name),
						characteristics : [Characteristic.ProgrammableSwitchEvent]
					};
					HBservice.controlService.cmd_id = cmd.state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.state.id + '-' + HBservice.controlService.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.thermostat) { // only one -> will change
			HBservice = {
				controlService : new Service.Thermostat(eqLogic.name),
				characteristics : [Characteristic.CurrentTemperature, Characteristic.TargetTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState]
			};
			HBservice.controlService.cmd_id = eqLogic.services.thermostat.id;
			if (!HBservice.controlService.subtype)
				HBservice.controlService.subtype = '';
			HBservice.controlService.subtype = eqLogic.id + '-' + eqLogic.services.thermostat.id + '-' + HBservice.controlService.subtype;
			HBservices.push(HBservice);
			HBservice = null;
		}
		if (eqLogic.services.alarm) {
			eqLogic.services.alarm.forEach(function(cmd) {
				if(cmd.enable_state) {
					var cmd_state = 0;
					var cmd_mode = 0;
					eqServicesCopy.alarm.forEach(function(cmd2) {
						if (cmd2.state) {
							if (cmd2.state.eqLogic_id == eqLogic.id) { // no value link, so using eqLogic id as there is only one alarm per eqlogic
								cmd_state = cmd2.state.id;
							}
						} else if (cmd2.mode) {
							if (cmd2.mode.eqLogic_id == eqLogic.id) { // no value link, so using eqLogic id as there is only one alarm per eqlogic
								cmd_mode = cmd2.mode.id;
							}
						}
					});
					HBservice = {
						controlService : new Service.SecuritySystem(eqLogic.name),
						characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState]
					};
					if(eqLogic.services.sabotage) HBservice.characteristics.push(Characteristic.StatusTampered);
					HBservice.controlService.cmd_id = cmd.enable_state.id;
					if (!HBservice.controlService.subtype)
						HBservice.controlService.subtype = '';
					var thisAlarm = that.alarms[eqLogic.id];
					var away_mode_id,away_mode_label,present_mode_label,present_mode_id,night_mode_label,night_mode_id;
					if(thisAlarm) {
						if(thisAlarm.mode_away) {
							away_mode_label = thisAlarm.mode_away.name;
							away_mode_id = thisAlarm.mode_away.id;
						}
						else
							that.log('warn','Pas de config du mode Absent');
						if(thisAlarm.mode_present) {
							present_mode_label = thisAlarm.mode_present.name;
							present_mode_id = thisAlarm.mode_present.id;
						}
						else
							that.log('warn','Pas de config du mode Présent');
						if(thisAlarm.mode_night) {
							night_mode_label = thisAlarm.mode_night.name;
							night_mode_id =thisAlarm.mode_night.id;
						}
						else
							that.log('warn','Pas de config du mode Nuit');
					}
					/*else {
						that.log('warn','Pas de config de l\'alarme'); // NOT YET DONE
					}*/
					HBservice.controlService.subtype = eqLogic.id + '-' + cmd.enable_state.id + '-' + cmd_state + '-' + cmd_mode + '-' + present_mode_id+'='+present_mode_label+'|'+away_mode_id+'='+away_mode_label+'|'+night_mode_id+'='+night_mode_label;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}

		if (HBservices.length != 0) {
			createdAccessory = that.createAccessory(HBservices, eqLogic);
			that.addAccessory(createdAccessory);
			HBservices = [];
		}
		else
		{
			that.log('│ Accessoire sans Type Générique');
			createdAccessory = that.createAccessory([], eqLogic); // create a cached lookalike object for unregistering it
			that.delAccessory(createdAccessory);
		}
		that.log('└─────────');
	}
	catch(e){
		this.log('error','Erreur de la fonction AccessoireCreateHomebridge :',e);
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [this.existingAccessory(createdAccessory.UUID,true)]);
		hasError=true;
	}		
};

// -- createAccessory
// -- Desc : Create the JeedomBridgedAccessory object
// -- Params --
// -- HBservices : translated homebridge services
// -- eqLogic : the jeedom eqLogic
JeedomPlatform.prototype.createAccessory = function(HBservices, eqLogic) {
	try{
		
		var accessory = new JeedomBridgedAccessory(HBservices);
		accessory.platform = this;
		accessory.log = this.log;
		accessory.name = eqLogic.name;

		accessory.UUID = UUIDGen.generate(eqLogic.id + accessory.name);
		accessory.context = {};
		accessory.context.uniqueSeed = eqLogic.id + accessory.name;
		accessory.context.eqLogic = eqLogic;
		
		accessory.model = eqLogic.eqType_name;
		accessory.manufacturer = 'Jeedom>'+ this.rooms[eqLogic.object_id] +'>'+accessory.name;
		accessory.serialNumber = '<'+eqLogic.id+'-'+eqLogic.logicalId+'>';
		accessory.services_add = HBservices;
		return accessory;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction createAccessory :',e);
		console.error(e.stack);
		hasError=true;
	}
};

// -- delAccessory
// -- Desc : deleting an Accessory from homebridge (if exists) and the local list
// -- Params --
// -- jeedomAccessory : JeedomBridgedAccessory to delete
// -- silence : flag for logging or not
// -- Return : nothing
JeedomPlatform.prototype.delAccessory = function(jeedomAccessory,silence) {
	var existingAccessory;
	try{
		silence = silence || false;
		if (!jeedomAccessory) {
			return;
		}

		if(!silence) this.log('│ Vérification d\'existance de l\'accessoire dans le cache Homebridge...');
		existingAccessory = this.existingAccessory(jeedomAccessory.UUID,silence);
		if(existingAccessory)
		{
			if(!silence) this.log('│ Suppression de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [existingAccessory]);
			delete this.accessories[jeedomAccessory.UUID];
			existingAccessory.reviewed=true;
		}
		else
		{
			if(!silence) this.log('│ Accessoire Ignoré');
		}
	}
	catch(e){
		this.log('error','│ Erreur de la fonction delAccessory :',e);
		console.error(e.stack);
		// force to unregister the accessory before quitting (avoid cache or persist corruption)
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [existingAccessory]);
		hasError=true;
	}
};

// -- addAccessory
// -- Desc : adding or updating an Accessory to homebridge and local list
// -- Params --
// -- jeedomAccessory : JeedomBridgedAccessory to add
// -- Return : nothing
JeedomPlatform.prototype.addAccessory = function(jeedomAccessory) {
	var HBAccessory;
	try{
		if (!jeedomAccessory) {
			return;
		}
		let isNewAccessory = false;
		let services2Add = jeedomAccessory.services_add;
		this.log('│ Vérification d\'existance de l\'accessoire dans le cache Homebridge...');
		HBAccessory = this.existingAccessory(jeedomAccessory.UUID);
		if (!HBAccessory) {
			this.log('│ Nouvel accessoire (' + jeedomAccessory.name + ')');
			isNewAccessory = true;
			HBAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.UUID);
			jeedomAccessory.initAccessory(HBAccessory);
			this.accessories[jeedomAccessory.UUID] = HBAccessory;
		}
		HBAccessory.context = jeedomAccessory.context;
		//No more supported by HAP-NodeJS
		//HBAccessory.reachable = true;
		//HBAccessory.updateReachability(true);
		
		if (isNewAccessory) {
			this.log('│ Ajout de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', [HBAccessory]);
		}else{
			let cachedValues=jeedomAccessory.delServices(HBAccessory);
			jeedomAccessory.addServices(HBAccessory,services2Add,cachedValues);
			this.log('│ Mise à jour de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.updatePlatformAccessories([HBAccessory]);
		}
		HBAccessory.on('identify', function(paired, callback) {
			this.log(HBAccessory.displayName, "->Identifié!!!");
			callback();
		}.bind(this));
		HBAccessory.reviewed = true;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction addAccessory :',e);
		console.error(e.stack);
		// unregister the accessory before quitting (avoid cache or persist corruption)
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [HBAccessory]);
		hasError=true;
	}
};

// -- existingAccessory
// -- Desc : check if the accessory exists in the local list
// -- Params --
// -- UUID : UUID to find
// -- silence : flag for logging or not
// -- Return : nothing
JeedomPlatform.prototype.existingAccessory = function(UUID,silence) {
	try{
		silence = silence || false;
		for (var a in this.accessories) {
			if (this.accessories.hasOwnProperty(a)) {
				if (this.accessories[a].UUID == UUID) {
					if(!silence) this.log('│ Accessoire déjà existant dans le cache Homebridge');
					return this.accessories[a];
				}
			}
		}
		if(!silence) this.log('│ Accessoire non existant dans le cache Homebridge');
		return null;
	}
	catch(e){
		this.log('error','│ Erreur de la fonction existingAccessory :',e);	
		console.error(e.stack);
		hasError=true;
	}
};

// -- configureAccessory
// -- Desc : Launched by Homebridge on the beginning, bind the event to the accessory found in the cache
// -- Params --
// -- accessory : the accessory to configure
// -- Return : nothing
JeedomPlatform.prototype.configureAccessory = function(accessory) {
	try{
		//this.log('debug',JSON.stringify(accessory).replace("\n",""));
		if(!accessory.context)// || !accessory.context.eqLogic)
		{
			// Remove this invalid device from the cache.
			this.log('debug','L\'accessoire est invalide, on le retire du cache Homebridge :',accessory.displayName);
			try {
				this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [accessory]);
			} catch (e) {
				this.log('error',"#45 Impossible de supprimer l'accessoire !" , e);
			}
			return;
		}
		
		for (var s = 0; s < accessory.services.length; s++) {
			var service = accessory.services[s];
			if (service.subtype) {
				var subtypeParams = service.subtype.split('-');
				if (subtypeParams.length == 3 && subtypeParams[2] == 'RGB') {
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
		this.log('Accessoire en cache: ' + accessory.displayName);
		this.accessories[accessory.UUID] = accessory;
		//accessory.reachable = true;
	}
	catch(e){
		this.log('error','Erreur de la fonction configureAccessory :',e);
		console.error(e.stack);
		hasError=true;
	}
};

// -- bindCharacteristicEvents
// -- Desc : bind the set and get event to the characteristic
// -- Params --
// -- characteristic : characteristic to bind event to
// -- service : service of the characteristic
// -- Return : nothing
JeedomPlatform.prototype.bindCharacteristicEvents = function(characteristic, service) {
	try{
		var readOnly = true;
		for (var i = 0; i < characteristic.props.perms.length; i++)
			if (characteristic.props.perms[i] == 'pw')
				readOnly = false;
		if(service.subtype)
			var IDs = service.subtype.split('-');
		this.subscribeUpdate(service, characteristic);
		if (!readOnly) {
			characteristic.on('set', function(value, callback, context) {
				if (context !== 'fromJeedom' && context !== 'fromSetValue') { // from Homekit
					this.log('info','[Commande d\'Homekit] Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+characteristic.value+'->'+value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
					this.setAccessoryValue(value,characteristic,service,IDs);
				} else
					this.log('info','[Commande de Jeedom] Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+value,'\t\t\t\t\t|||context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				callback();
			}.bind(this));
		}
		characteristic.on('get', function(callback) {
			this.log('info','[Demande d\'Homekit] IDs:'+IDs,'Nom:'+service.displayName+'>'+characteristic.displayName+'='+characteristic.value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
			let returnValue = this.getAccessoryValue(characteristic, service, IDs);
			callback(undefined, sanitizeValue(returnValue,characteristic));
		}.bind(this));
	}
	catch(e){
		this.log('error','Erreur de la fonction bindCharacteristicEvents :',e);
		console.error(e.stack);
		hasError=true;
	}
};

// -- setAccessoryValue
// -- Desc : set the value of an accessory in Jeedom
// -- Params --
// -- value : the value to set
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.setAccessoryValue = function(value, characteristic, service, IDs) {
	try{
		//var that = this;
		var cmds = IDs[1].split('|');
		var action,rgb;
		switch (characteristic.UUID) {
			case Characteristic.On.UUID :
					this.command(value == 0 ? 'turnOff' : 'turnOn', null, service, IDs);
			break;
			case Characteristic.TargetTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevel', value, service, IDs);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.setValue(sanitizeValue(value,characteristic), undefined, 'fromSetValue');
				}, 100);
			break;
			case Characteristic.TimeInterval.UUID :
				this.command('setTime', value + Math.trunc((new Date()).getTime() / 1000), service, IDs);
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				this.log('set target mode');
				this.command('TargetHeatingCoolingState', value, service, IDs);
			break;
			case Characteristic.TargetDoorState.UUID :
				this.command('GBtoggle', 0, service, IDs);
			break;
			case Characteristic.LockTargetState.UUID :
				action = value == Characteristic.LockTargetState.UNSECURED ? 'unsecure' : 'secure';
				this.command(action, 0, service, IDs);
			break;
			case Characteristic.SecuritySystemTargetState.UUID:
				this.command('SetAlarmMode', value, service, IDs);
			break;
			case Characteristic.CurrentPosition.UUID:
			case Characteristic.TargetPosition.UUID:
			case Characteristic.PositionState.UUID: // could be Service.Window or Service.Door too so we check
				if (service.UUID == Service.WindowCovering.UUID) {
					var Down = parseInt(cmds[1]);
					var Up = parseInt(cmds[2]);
					var Slider = parseInt(cmds[3]);
					if(Down && Up) {
						if (Slider) {
							if (value == 0)
								action = 'flapDown';
							else if (value == 99 || value == 100)
								action = 'flapUp';
							else
								action = 'setValue';
						}
						else {
							if (value < 50)
								action = 'flapDown';
							else
								action = 'flapUp';
						}
					}
					else if (Slider) {
						action = 'setValue';
					}

					this.command(action, value, service, IDs);
				}
			break;
			case Characteristic.Hue.UUID :
				rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
				this.syncColorCharacteristics(rgb, service, IDs);
			break;
			case Characteristic.Saturation.UUID :
				rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
				this.syncColorCharacteristics(rgb, service, IDs);
			break;
			case Characteristic.Brightness.UUID :
				if (service.HSBValue != null) {
					rgb = this.updateJeedomColorFromHomeKit(null, null, value, service);
					this.syncColorCharacteristics(rgb, service, IDs);
				} else {
					this.command('setValue', value, service, IDs);
				}
			break;
			default :
				this.command('setValue', value, service, IDs);
			break;
		}
	
	}
	catch(e){
		this.log('error','Erreur de la fonction setAccessoryValue :',e);
		console.error(e.stack);
	}
};

// -- getAccessoryValue
// -- Desc : Get the value of an accessory in the jeedom local cache
// -- Params --
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.getAccessoryValue = function(characteristic, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		var returnValue = 0;
		var HRreturnValue;
		var cmdList = that.jeedomClient.getDeviceCmd(IDs[0]);
		var hsv,modesCmd,mode_PRESENT,mode_AWAY,mode_NIGHT,t;
		switch (characteristic.UUID) {
			case Characteristic.OutletInUse.UUID :
				returnValue = parseFloat(cmdList.power) > 1.0 ? true : false;
			break;
			case Characteristic.NotificationCode.UUID :
			break;
			case Characteristic.NotificationText.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GENERIC_INFO') {
						let maxSize = 64;
						returnValue = cmd.currentValue.toString().substring(0,maxSize);
						break;
					}
				}
			break;
			case Characteristic.TimeInterval.UUID :
				returnValue = Date.now();
				returnValue = parseInt(cmdList.timestamp) - returnValue;
				if (returnValue < 0) returnValue = 0;
			break;
			case Characteristic.TargetTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_SETPOINT') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.Hue.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.h);
			break;
			case Characteristic.Saturation.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						returnValue = cmd.currentValue;
						break;
					}
				}
				hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.v);
			break;
			case Characteristic.SmokeDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SMOKE' && cmd.id == cmds[0]) {
						//returnValue = cmds[1]==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) returnValue = Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
						else returnValue = Characteristic.SmokeDetected.SMOKE_DETECTED;						
						break;
					}
				}
			break;
			case Characteristic.LeakDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLOOD' && cmd.id == cmds[0]) {
						//returnValue = cmds[1]==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) returnValue = Characteristic.LeakDetected.LEAK_NOT_DETECTED;
						else returnValue = Characteristic.LeakDetected.LEAK_DETECTED;
						break;
					}
				}
			break;
			case Characteristic.MotionDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'PRESENCE' && cmd.id == cmds[0]) {
						//returnValue = cmds[1]==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert ?
						returnValue = toBool(cmd.currentValue);
						break;
					}
				}
			break;
			case Characteristic.ContactSensorState.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'OPENING' || cmd.generic_type == 'OPENING_WINDOW') && cmd.id == cmds[0]) {
						returnValue = parseInt(cmds[1])==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
						if(returnValue === false) returnValue = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
						else returnValue = Characteristic.ContactSensorState.CONTACT_DETECTED;
						break;
					}
				}
			break;
			case Characteristic.Brightness.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if (service.HSBValue != null) {
						if (cmd.generic_type == 'LIGHT_COLOR') {
							//console.log("valeur " + cmd.generic_type + " : " + returnValue);
							hsv = that.updateHomeKitColorFromJeedom(cmd.currentValue, service);
							returnValue = Math.round(hsv.v);
							break;
						}
					} else if (cmd.generic_type == 'LIGHT_STATE' && cmd.id == cmds[0]) {
						returnValue = Math.round(parseInt(cmd.currentValue) * 100/99); // brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to %
						//console.log("valeur " + cmd.generic_type + " : " + returnValue);
						break;
					}
				}
			break;
			case Characteristic.SecuritySystemTargetState.UUID :
				for (const cmd of cmdList) {
					let currentValue = cmd.currentValue;
					
					if (cmd.generic_type == 'ALARM_ENABLE_STATE' && currentValue == 0) {
						that.log('debug',"Alarm_enable_state=",currentValue);
						returnValue = Characteristic.SecuritySystemTargetState.DISARM;
						break;
					}
					if (cmd.generic_type == 'ALARM_MODE') {
						that.log('debug',"alarm_mode=",currentValue);
						modesCmd = IDs[4].split('|');
						
						for(const c in modesCmd) {
							if (modesCmd.hasOwnProperty(c)) {
								t = modesCmd[c].split('=');
								switch (parseInt(c)) {
										case 0:
											mode_PRESENT = t[1];
										break;
										case 1:
											mode_AWAY = t[1];
										break;
										case 2:
											mode_NIGHT = t[1];
										break;
								}
							}
						}
						switch (currentValue) {
							case mode_PRESENT:
								that.log('debug',"renvoie present",Characteristic.SecuritySystemTargetState.STAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.STAY_ARM;
							break;
							case mode_AWAY:
								that.log('debug',"renvoie absent",Characteristic.SecuritySystemTargetState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;
							case mode_NIGHT:
								that.log('debug',"renvoie nuit",Characteristic.SecuritySystemTargetState.NIGHT_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.NIGHT_ARM;
							break;
							default: // back compatibility
								that.log('debug',"renvoie absent",Characteristic.SecuritySystemTargetState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;
						}
					}
				}
			break;
			case Characteristic.SecuritySystemCurrentState.UUID :
				for (const cmd of cmdList) {
					let currentValue = cmd.currentValue;
					
					if (cmd.generic_type == 'ALARM_STATE' && currentValue == 1) {
						that.log('debug',"Alarm_State=",currentValue);
						returnValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
						break;
					}
					if (cmd.generic_type == 'ALARM_ENABLE_STATE' && currentValue == 0) {
						that.log('debug',"Alarm_enable_state=",currentValue);
						returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
						break;
					}
					if (cmd.generic_type == 'ALARM_MODE') {
						that.log('debug',"alarm_mode=",currentValue);
						modesCmd = IDs[4].split('|');
						
						for(const c in modesCmd) {
							if (modesCmd.hasOwnProperty(c)) {
								t = modesCmd[c].split('=');
								switch (parseInt(c)) {
										case 0:
											mode_PRESENT = t[1];
										break;
										case 1:
											mode_AWAY = t[1];
										break;
										case 2:
											mode_NIGHT = t[1];
										break;
								}
							}
						}
						switch (currentValue) {
							case mode_PRESENT:
								that.log('debug',"renvoie present",Characteristic.SecuritySystemCurrentState.STAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.STAY_ARM;
							break;
							case mode_AWAY:
								that.log('debug',"renvoie absent",Characteristic.SecuritySystemCurrentState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;
							case mode_NIGHT:
								that.log('debug',"renvoie nuit",Characteristic.SecuritySystemCurrentState.NIGHT_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
							break;
							default: // back compatibility
								that.log('debug',"renvoie absent",Characteristic.SecuritySystemCurrentState.AWAY_ARM);
								returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;
						}
					}
				}
			break;
			case Characteristic.CurrentHeatingCoolingState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_MODE') {
						if (cmd.currentValue == 'Off') {
							returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
						} else {
							returnValue = Characteristic.CurrentHeatingCoolingState.AUTO;
						}
						break;
					}
				}
			break;
			case Characteristic.PositionState.UUID :
				returnValue = Characteristic.PositionState.STOPPED;
			break;
			case Characteristic.ProgrammableSwitchEvent.UUID :
				returnValue = cmdList.currentValue;
				that.log('debug','GetState ProgrammableSwitchEvent: '+returnValue);
			break;
			case Characteristic.LockCurrentState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						that.log('debug','LockCurrentState : ',cmd.currentValue);
						returnValue = toBool(cmd.currentValue) == true ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
					}
				}
			break;
			case Characteristic.LockTargetState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						that.log('debug','LockTargetState : ',cmd.currentValue);
						returnValue = toBool(cmd.currentValue) == true ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
					}
				}
			break;
			case Characteristic.TargetDoorState.UUID :
				HRreturnValue="OPENDef";
				returnValue=Characteristic.TargetDoorState.OPEN; // if don't know -> OPEN
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
					    cmd.generic_type == 'BARRIER_STATE') {
						switch(parseInt(cmd.currentValue)) {
								case 255 :
									returnValue=Characteristic.TargetDoorState.OPEN; //0
									HRreturnValue="OPEN";	
								break;
								case 0 :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case 254 :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
								case 252 :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case 253 :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
						}
						that.log('debug','Target Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						break;
					}
				}	
			break;
			case Characteristic.CurrentDoorState.UUID :
				HRreturnValue="OPENDef";
				returnValue=Characteristic.CurrentDoorState.OPEN; // if don't know -> OPEN
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
					    cmd.generic_type == 'BARRIER_STATE') {
						switch(parseInt(cmd.currentValue)) {
								case 255 :
									returnValue=Characteristic.CurrentDoorState.OPEN; //0
									HRreturnValue="OPEN";
								break;
								case 0 :
									returnValue=Characteristic.CurrentDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case 254 :
									returnValue=Characteristic.CurrentDoorState.OPENING; // 2
									HRreturnValue="OPENING";
								break;
								case 252 :
									returnValue=Characteristic.CurrentDoorState.CLOSING; // 3
									HRreturnValue="CLOSING";
								break;
								case 253 :
									returnValue=Characteristic.CurrentDoorState.STOPPED; // 4
									HRreturnValue="STOPPED";
								break;
						}
						that.log('debug','Etat Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						break;
					}
				}
			break;
			case Characteristic.CurrentPosition.UUID :
			case Characteristic.TargetPosition.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_STATE' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						returnValue = returnValue > 95 ? 100 : returnValue; // >95% is 100% in home (flaps need yearly tunning)
						break;
					}
				}
			break;
			case Characteristic.CurrentTemperature.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'TEMPERATURE' && cmd.id == cmds[0]) || 
					    cmd.generic_type == 'THERMOSTAT_TEMPERATURE') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.UVIndex.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'UV' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;			
			case Characteristic.CurrentAmbientLightLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BRIGHTNESS' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.CurrentRelativeHumidity.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'HUMIDITY' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.BatteryLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.StatusLowBattery.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						if(returnValue > 20) returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
						else returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
						break;
					}
				}
			break;
			case Characteristic.ChargingState.UUID :
				var hasFound = false;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY_CHARGING' && cmd.id == cmds[1]) {
						returnValue = cmd.currentValue;
						if(returnValue == 0) returnValue = Characteristic.ChargingState.NOT_CHARGING;
						else returnValue = Characteristic.ChargingState.CHARGING;
						hasFound = true;
						break;
					}
				}
				if(!hasFound) returnValue = Characteristic.ChargingState.NOT_CHARGEABLE;
			break;
			case Characteristic.StatusTampered.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SABOTAGE') {
						// not managing the invertBinary
						returnValue = cmd.currentValue;
						if(returnValue == 0) returnValue=Characteristic.StatusTampered.NOT_TAMPERED;
						else returnValue=Characteristic.StatusTampered.TAMPERED;
						break;
					}
				}
			break;
			case Characteristic.CurrentPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'POWER' && cmd.id == cmds[0]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.TotalPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CONSUMPTION' && cmd.id == cmds[1]) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.On.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'LIGHT_STATE' && cmd.id == cmds[0]) || 
						(cmd.generic_type == "ENERGY_STATE" && cmd.id == cmds[0])) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
		}
		return returnValue;
	}
	catch(e){
		this.log('error','Erreur de la fonction getAccessoryValue :',e);
		console.error(e.stack);
	}
};

// -- sanitizeValue
// -- Desc : limit the value to the min and max characteristic + round the float to the same precision than the minStep
// -- Params --
// -- currentValue : value to prepare
// -- characteristic : characteristic containing the props
// -- Return : prepared value
function sanitizeValue(currentValue,characteristic) {
	let val=0;
	if(!characteristic) // just return the value if no characteristic
		return val;
	else
		if(!characteristic.props) 
			return val;
		else 
			if(!characteristic.props.format) 
				return val;

	switch(characteristic.props.format) {
			case "uint8" :
			case "uint16":
			case "uint32" :
			case "uint64" :
				val = parseInt(currentValue);
				val = Math.abs(val); // unsigned
				if(!val) val = 0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) val = parseInt(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) val = parseInt(characteristic.props.maxValue);		
			break;
			case "int" :
				val = parseInt(currentValue);
				if(!val) val = 0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) val = parseInt(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) val = parseInt(characteristic.props.maxValue);	
			break;
			case "float" :
				val = minStepRound(parseFloat(currentValue),characteristic);
				if(!val) val = 0.0;
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseFloat(characteristic.props.minValue)) val = parseFloat(characteristic.props.minValue);
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseFloat(characteristic.props.maxValue)) val = parseFloat(characteristic.props.maxValue);	
			break;
			case "bool" :
				val = toBool(currentValue);
				if(!val) val = false;
			break;
			case "string" :
			case "tlv8" :
				val = currentValue.toString();
				if(!val) val = '';
			break;
	}
	return val;
}

// -- minStepRound
// -- Desc : round the value to the same precision than the minStep
// -- Params --
// -- val : value to round
// -- characteristic : characteristic containing the props
// -- Return : rounded value
function minStepRound(val,characteristic) {
	if(characteristic.props.minStep != null && characteristic.props.minStep != undefined) {
		characteristic.props.minStep = 1;
	}
	let prec = (characteristic.props.minStep.toString().split('.')[1] || []).length;
	if(val) {
		val = val * Math.pow(10, prec);
		val = Math.round(val); // round to the minStep precision
		val = val / Math.pow(10, prec);
	}
	return val;
}

// -- toBool
// -- Desc : transform to boolean a value
// -- Params --
// -- value : value to convert into boolean
// -- Return : boolean value
function toBool(val) {
	if (val == 'false' || val == '0') {
		return false;
	} else {
		return Boolean(val);
	}
}

// -- command
// -- Desc : Command from Homebridge to execute in Jeedom
// -- Params --
// -- action : command type
// -- value : value to set (if any)
// -- service : from which Homebridge service
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.command = function(action, value, service, IDs) {
	try{
		var that = this;
		var cmds = IDs[1].split('|');
		var cmdList = that.jeedomClient.getDeviceCmd(IDs[0]); 
		var cmdId = cmds[0];
		let found=false;
		// ALARM
		var id_PRESENT,id_AWAY,id_NIGHT;
		if(action == 'SetAlarmMode') {
			var modesCmd = IDs[4].split('|');
			for(const c in modesCmd) {
				if (modesCmd.hasOwnProperty(c)) {
					var t = modesCmd[c].split('=');
					switch (parseInt(c)) {
							case 0:
								id_PRESENT = t[0];
							break;
							case 1:
								id_AWAY = t[0];
							break;
							case 2:
								id_NIGHT = t[0];
							break;
					}
				}
			}
		}
		// /ALARM		
		for (const cmd of cmdList) {
			if(!found) {
				switch (cmd.generic_type) {
					case 'FLAP_DOWN' :
						if(action == 'flapDown' && cmd.id == cmds[1]) {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'FLAP_UP' :
						if(action == 'flapUp'  && cmd.id == cmds[2]) {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'GB_OPEN' :
						if(action == 'GBopen') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'GB_CLOSE' :
						if(action == 'GBclose') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'GB_TOGGLE' :
						if(action == 'GBtoggle') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'LOCK_OPEN' :
						if(action == 'unsecure') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'LOCK_CLOSE' :
						if(action == 'secure') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'LIGHT_SLIDER' :
					case 'FLAP_SLIDER' :
						if(value >= 0 && cmd.id == cmds[3]) {
							cmdId = cmd.id;
							if (action == 'turnOn' && cmds[1]) {
								cmdId=cmds[1];
							} else if (action == 'turnOff' && cmds[2]) {
								cmdId=cmds[2];
							}		
							// brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to Zwave
							value =	Math.round(value * 99/100);							
							found = true;
						}
					break;
					case 'LIGHT_ON' :
					case 'ENERGY_ON' :
						if((value == 255 || action == 'turnOn') && cmd.id == cmds[1]) {
							cmdId = cmd.id;					
							found = true;
						}
					break;
					case 'LIGHT_OFF' :
					case 'ENERGY_OFF' :
						if((value == 0 || action == 'turnOff') && cmd.id == cmds[2]) {
							cmdId = cmd.id;					
							found = true;
						}
					break;
					case 'LIGHT_SET_COLOR' :
						if(action == 'setRGB') {
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'ALARM_RELEASED' :
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.DISARM) {
								that.log('debug',"setAlarmMode",value,cmd.id);
 								cmdId = cmd.id;
 								found = true;
						}
					break;
					case 'ALARM_SET_MODE' :
						console.log("ALARM_SET_MODE","SetAlarmMode=",action,value);
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.NIGHT_ARM) {
							cmdId = id_NIGHT;
							console.log("set nuit");
							found = true;
						}
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.AWAY_ARM) {
							cmdId = id_AWAY;
							console.log("set absent");
							found = true;
						}
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.STAY_ARM) {
							cmdId = id_PRESENT;
							console.log("set present");
							found = true;
 						}
 					break;					
					case 'THERMOSTAT_SET_SETPOINT' :
						if(action == 'setTargetLevel') {
							if(value > 0) {
								cmdId = cmd.id;
								found = true;
							}
						}
					break;
					case 'THERMOSTAT_SET_MODE' :
						if(action == 'TargetHeatingCoolingState') {
							if(cmd.name == 'Off') {
								cmdId = cmd.id;
								found = true;
							}
						}
					break;
				}
			}
		}
		
		that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
			that.log('info','[Commande envoyée à Jeedom] cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
		}).catch(function(err, response) {
			that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + IDs[0] , err , response);
			console.error(err.stack);
		});
	}
	catch(e){
		this.log('error','Erreur de la fonction command :',e);	
		console.error(e.stack);
	}
};

// -- subscribeUpdate
// -- Desc : Populate the subscriptions to the characteristic. if the value is changed, the characteristic will be updated
// -- Params --
// -- service : service containing the characteristic to subscribe to
// -- characteristic : characteristic to subscribe to
// -- Return : nothing
JeedomPlatform.prototype.subscribeUpdate = function(service, characteristic) {
	try{
		if (characteristic.UUID == Characteristic.PositionState.UUID)
			return;

		var IDs = service.subtype.split('-');
		this.updateSubscriptions.push({
			'id' : IDs[0],
			'service' : service,
			'characteristic' : characteristic
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction subscribeUpdate :',e);
		console.error(e.stack);
		hasError=true;
	}
};

// -- startPollingUpdate
// -- Desc : Get the last status from Jeedom and act on it (update model and subscribers)
// -- Params --
// -- Return : nothing
JeedomPlatform.prototype.startPollingUpdate = function() {
	var that = this;
	if(that.pollingUpdateRunning) {return;}
	that.pollingUpdateRunning = true;
	that.jeedomClient.refreshStates().then(function(updates) {
		that.lastPoll = updates.datetime;
		if (updates.result) {
			updates.result.map(function(update) {
				if (update.name == 'cmd::update' && 
				    update.option.value != undefined && 
				    update.option.cmd_id) {
					that.jeedomClient.updateModelInfo(update.option.cmd_id,update.option.value); // Update cachedModel
					setTimeout(function(){that.updateSubscribers(update);},50);
				}
				else {
					if(DEV_DEBUG) that.log('debug','[Reçu Type non géré]: '+update.name+' contenu: '+JSON.stringify(update).replace("\n",""));
				}
			});
		}
	}).then(function(){
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','==RESTART POLLING==');that.startPollingUpdate(); }, that.pollerPeriod * 1000);
	}).catch(function(err, response) {
		that.log('error','Erreur de récupération des évènements de mise à jour: ', err, response);
		console.error(err.stack);
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','!!RESTART POLLING AFTER ERROR!!');that.startPollingUpdate(); }, that.pollerPeriod * 2 * 1000);
	});
};

// -- updateSubscribers
// -- Desc : update subcribers populated by the subscribeUpdate method
// -- Params --
// -- update : the update received from Jeedom
// -- Return : nothing
var alarmMode = null;
var alarmModeTarget = null;
JeedomPlatform.prototype.updateSubscribers = function(update) {
	var that = this;
	var i,subscription,IDs,subCharact,HRreturnValue;
	var FC = update.option.value[0];
	
	if(FC == '#') update.color=update.option.value;
	else update.color=undefined;
	
	var value = parseInt(update.option.value);
	var newValue=0;
	if (isNaN(value))
		value = (update.option.value === 'true');
	
	if (update.name == 'cmd::update' && 
	    update.option.value != undefined && 
	    update.option.cmd_id) {
		//that.log('debug','cmd : '+JSON.stringify(cmd));
		var cmd_id,cmd2_id,cmd3_id,cmds;
		for (i = 0; i < that.updateSubscriptions.length; i++) {
			subscription = that.updateSubscriptions[i];
			if (subscription.service.subtype) {
				IDs = subscription.service.subtype.split('-');
				cmds = IDs[1].split('|');
				cmd_id = cmds[0];
				cmd2_id = IDs[2];
				cmd3_id = IDs[3];
			}
			subCharact = subscription.characteristic;
			if (cmd_id == update.option.cmd_id || cmd2_id == update.option.cmd_id || cmd3_id == update.option.cmd_id) {
				var intervalValue = false;
				var mode_PRESENT,mode_AWAY,mode_NIGHT,t,modesCmd,v;
				switch(subCharact.UUID) {
					case Characteristic.TimeInterval.UUID :
						intervalValue = true;
					break;
					case Characteristic.SecuritySystemCurrentState.UUID :
						that.log('debug',"Current",alarmMode);
						if (cmd2_id == update.option.cmd_id) { 
							if(value == 1) {// if ALARM_STATE == 1 : RING !
								that.log('debug',"ALARM !!!");
								subCharact.setValue(sanitizeValue(Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED,subCharact), undefined, 'fromJeedom');
								alarmMode = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
							} else {
								alarmMode = null;
							}
						} else if (cmd_id == update.option.cmd_id) { 
							if(value == 0) {// if ALARM_ENABLE_STATE == 0 : disabled
								if(alarmMode != Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
									that.log('debug',"disarmed");
									subCharact.setValue(sanitizeValue(Characteristic.SecuritySystemCurrentState.DISARMED,subCharact), undefined, 'fromJeedom');
									alarmMode = Characteristic.SecuritySystemCurrentState.DISARMED;
								}
							} else {
								alarmMode = null;
							}
						} else if(cmd3_id == update.option.cmd_id) { // else switch with value of ALARM_MODE
							if(alarmMode != Characteristic.SecuritySystemCurrentState.DISARMED && alarmMode != Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED) {
								that.log('debug',"value : ",update.option.display_value);
								// we set the mode Strings
								modesCmd = IDs[4].split('|');
								for(const c in modesCmd) {
									if (modesCmd.hasOwnProperty(c)) {
										t = modesCmd[c].split('=');
										switch (parseInt(c)) {
												case 0:
													mode_PRESENT = t[1];
												break;
												case 1:
													mode_AWAY = t[1];
												break;
												case 2:
													mode_NIGHT = t[1];
												break;
										}
									}
								}
								v=Characteristic.SecuritySystemCurrentState.DISARMED;
								switch(update.option.display_value) {
									case mode_PRESENT :
										v=Characteristic.SecuritySystemCurrentState.STAY_ARM;
									break;
									case mode_AWAY :
										v=Characteristic.SecuritySystemCurrentState.AWAY_ARM;
									break;
									case mode_NIGHT :
										v=Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
									break;
								}
								subCharact.setValue(sanitizeValue(v,subCharact), undefined, 'fromJeedom');
								alarmMode = null;
							}
 						}
					break;
					case Characteristic.SecuritySystemTargetState.UUID :
						that.log('debug',"Target",alarmModeTarget);
						if (cmd_id == update.option.cmd_id) { 
							if(value == 0) {// if ALARM_ENABLE_STATE == 0 : disabled
								that.log('debug',"disarm");
								subCharact.setValue(sanitizeValue(Characteristic.SecuritySystemTargetState.DISARM,subCharact), undefined, 'fromJeedom');
								alarmModeTarget = Characteristic.SecuritySystemTargetState.DISARM;
							} else {
								alarmModeTarget = null;
							}
						} else if (cmd3_id == update.option.cmd_id) { // else switch with value of ALARM_MODE
							if(alarmModeTarget != Characteristic.SecuritySystemTargetState.DISARM) {
								that.log('debug',"value : ",update.option.display_value);
								// we set the mode Strings)
								modesCmd = IDs[4].split('|');
								for(const c in modesCmd) {
									if (modesCmd.hasOwnProperty(c)) {
										t = modesCmd[c].split('=');
										switch (parseInt(c)) {
												case 0:
													mode_PRESENT = t[1];
												break;
												case 1:
													mode_AWAY = t[1];
												break;
												case 2:
													mode_NIGHT = t[1];
												break;
										}
									}
								}
								v=Characteristic.SecuritySystemTargetState.DISARM;
								switch(update.option.display_value) {
									case mode_PRESENT :
										v=Characteristic.SecuritySystemTargetState.STAY_ARM;
									break;
									case mode_AWAY :
										v=Characteristic.SecuritySystemTargetState.AWAY_ARM;
									break;
									case mode_NIGHT :
										v=Characteristic.SecuritySystemTargetState.NIGHT_ARM;
									break;
									case 0 : // if ALARM RING
										v=alarmModeTarget; // display previous mode
									break;
								}
								subCharact.setValue(sanitizeValue(v,subCharact), undefined, 'fromJeedom');
								alarmModeTarget = v;
							}
						}			
					break;
					case Characteristic.SmokeDetected.UUID :
						//newValue = cmds[1]==0 ? toBool(value) : !toBool(value); // invertBinary ? // no need to invert ?
						newValue = toBool(value);
						if(newValue === false) newValue = Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
						else newValue = Characteristic.SmokeDetected.SMOKE_DETECTED;
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.LeakDetected.UUID :
						//newValue = cmds[1]==0 ? toBool(value) : !toBool(value); // invertBinary ? // no need to invert ?
						newValue = toBool(value);
						if(newValue === false) newValue = Characteristic.LeakDetected.LEAK_NOT_DETECTED;
						else newValue = Characteristic.LeakDetected.LEAK_DETECTED;
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.StatusTampered.UUID :
						// not managing the invertBinary
						if(value == 0 || isNaN(value))
							subCharact.setValue(sanitizeValue(Characteristic.StatusTampered.NOT_TAMPERED,subCharact), undefined, 'fromJeedom');
						else
							subCharact.setValue(sanitizeValue(Characteristic.StatusTampered.TAMPERED,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.MotionDetected.UUID :
						//newValue = cmds[1]==0 ? toBool(value) : !toBool(value); // invertBinary ? // no need to invert
						newValue = toBool(value);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.ContactSensorState.UUID :
						newValue = parseInt(cmds[1])==0 ? toBool(value) : !toBool(value); // invertBinary ?
						if(newValue === false) newValue = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
						else newValue = Characteristic.ContactSensorState.CONTACT_DETECTED;
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.ChargingState.UUID :
						if (cmds[1] != 'NOT') { // have BATTERY_CHARGING
							// not managing the invertBinary
							newValue = toBool(value);
							if(newValue === false) newValue = Characteristic.ChargingState.NOT_CHARGING;
							else newValue = Characteristic.ChargingState.CHARGING;
						} else {
							newValue = Characteristic.ChargingState.NOT_CHARGEABLE;
						}						
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.CurrentDoorState.UUID :
						v=Characteristic.CurrentDoorState.OPEN; // if not -> OPEN
						HRreturnValue="OPENDef";
						switch(parseInt(value)) {
							case 255 :
								v=Characteristic.CurrentDoorState.OPEN; // 0
								HRreturnValue="OPEN";
							break;
							case 0 :
								v=Characteristic.CurrentDoorState.CLOSED; // 1
								HRreturnValue="CLOSED";
							break;
							case 254 : 
								v=Characteristic.CurrentDoorState.OPENING; // 2
								HRreturnValue="OPENING";
							break;
							case 252 :
								v=Characteristic.CurrentDoorState.CLOSING; // 3
								HRreturnValue="CLOSING";
							break;
							case 253 :
								v=Characteristic.CurrentDoorState.STOPPED; // 4
								HRreturnValue="STOPPED";
							break;
						}
						that.log('debug','Etat(sub) Garage/Barrier Homekit: '+v+' soit en Jeedom:'+value+" ("+HRreturnValue+")");
						subCharact.setValue(sanitizeValue(v,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.TargetDoorState.UUID :
						v=Characteristic.TargetDoorState.OPEN; // if not -> OPEN
						HRreturnValue="OPENDef";
						switch(parseInt(value)) {
							case 255 :
								v=Characteristic.TargetDoorState.OPEN; // 0
								HRreturnValue="OPEN";
							break;
							case 0 :
								v=Characteristic.TargetDoorState.CLOSED; // 1
								HRreturnValue="CLOSED";
							break;
							case 254 : 
								v=Characteristic.TargetDoorState.OPEN; // 0
								HRreturnValue="OPEN";
							break;
							case 252 :
								v=Characteristic.TargetDoorState.CLOSED; // 1
								HRreturnValue="CLOSED";
							break;
							case 253 :
								v=Characteristic.TargetDoorState.OPEN; // 0
								HRreturnValue="OPEN";
							break;
						}
						that.log('debug','Target(sub) Garage/Barrier Homekit: '+v+' soit en Jeedom:'+value+" ("+HRreturnValue+")");
						subCharact.setValue(sanitizeValue(v,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.ProgrammableSwitchEvent.UUID :
						that.log('debug',"Valeur de ProgrammableSwitchEvent :"+value);
						subCharact.setValue(sanitizeValue(value,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.LockCurrentState.UUID :
						newValue = toBool(value) == true ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
						that.log('debug','LockCurrentState(sub) : ',newValue);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.LockTargetState.UUID :
						newValue = toBool(value) == true ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
						that.log('debug','LockTargetState(sub) : ',newValue);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.CurrentPosition.UUID :
					case Characteristic.TargetPosition.UUID :
						if (value >= subCharact.props.minValue && value <= subCharact.props.maxValue)
							subCharact.setValue(sanitizeValue(value,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.OutletInUse.UUID :
						if (update.power != undefined) {
							newValue = parseFloat(update.power) > 1.0 ? true : false;
							subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
						}
					break;
					case Characteristic.Brightness.UUID :
						newValue = Math.round(value * 100/99);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.On.UUID :
						subCharact.setValue(sanitizeValue(value,subCharact), undefined, 'fromJeedom');
					break;
					default :
						subCharact.setValue(sanitizeValue(value,subCharact), undefined, 'fromJeedom');
					break;
				} 
			}
		}
	}
	if (update.color) {
		var found=false;
		for (i = 0; i < that.updateSubscriptions.length; i++) {
			subscription = that.updateSubscriptions[i];
			IDs = subscription.service.subtype.split('-');
			if (IDs[1] == update.option.cmd_id && subscription.service.HSBValue) {
				var hsv = that.updateHomeKitColorFromJeedom(update.color, subscription.service);
				subCharact =  subscription.characteristic;
				switch(subCharact.UUID)
				{
					case Characteristic.On.UUID :
						//that.log('debug','update On :'+hsv.v == 0 ? false : true);
						newValue = hsv.v == 0 ? false : true;
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.Hue.UUID :
						//that.log('debug','update Hue :'+Math.round(hsv.h));
						newValue = Math.round(hsv.h);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.Saturation.UUID :
						//that.log('debug','update Sat :'+Math.round(hsv.s));
						newValue = Math.round(hsv.s);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
					case Characteristic.Brightness.UUID :
						//that.log('debug','update Bright :'+Math.round(hsv.v));
						newValue = Math.round(hsv.v);
						subCharact.setValue(sanitizeValue(newValue,subCharact), undefined, 'fromJeedom');
					break;
				}
				found=true;
			}
			else if (found==true) // after all founds
			{
				break;
			}
		}
	}
};

// -- updateJeedomColorFromHomeKit
// -- Desc : convert HSV value (Homebridge) to html value (Jeedom)
// -- Params --
// -- h : Hue
// -- s : Saturation
// -- v : Value (brightness)
// -- service : service containing the color
// -- Return : rgb object
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

// -- updateHomeKitColorFromJeedom
// -- Desc : convert html value (Jeedom) to HSV value (Homebridge)
// -- Params --
// -- color : html color #121212
// -- service : service containing the color
// -- Return : hsv object
JeedomPlatform.prototype.updateHomeKitColorFromJeedom = function(color, service) {
	if (!color)
		color = '0,0,0';
	//console.log("couleur :" + color);
	//var colors = color.split(',');
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

// -- syncColorCharacteristics
// -- Desc : set color in jeedom
// -- Params --
// -- rgb : rgb object
// -- service : service to set color to
// -- IDs : eqLogic ID
// -- Return : nothing
JeedomPlatform.prototype.syncColorCharacteristics = function(rgb, service, IDs) {
	switch (--service.countColorCharacteristics) {
	case -1:
		service.countColorCharacteristics = 2;
		var that = this;
		service.timeoutIdColorCharacteristics = setTimeout(function() {
			if (service.countColorCharacteristics < 2)
				return;
			var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
			that.command('setRGB', rgbColor, service, IDs);
			service.countColorCharacteristics = 0;
			service.timeoutIdColorCharacteristics = 0;
		}, 1000);
		break;
	case 0:
		var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
		this.command('setRGB', rgbColor, service, IDs);
		service.countColorCharacteristics = 0;
		service.timeoutIdColorCharacteristics = 0;
		break;
	default:
		break;
	}
};

// -- RegisterCustomCharacteristics
// -- Desc : Register some custom characteristic in Homebridge
// -- Params --
// -- Return : nothing
function RegisterCustomCharacteristics() {
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
			unit : 'watts',
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
			unit : 'kilowatthours',
			maxValue : 1000000000,
			minValue : 0,
			minStep : 0.001,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TotalPowerConsumption, Characteristic);
	Characteristic.TotalPowerConsumption.UUID = 'E863F10C-079E-48FF-8F27-9C2605A29F52';

	Characteristic.UVIndex = function() {
		Characteristic.call(this, 'UV Index', '05ba0fe0-b848-4226-906d-5b64272e05ce');
		this.setProps({
			format: Characteristic.Formats.UINT8,
			maxValue: 10,
			minValue: 0,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.UVIndex, Characteristic);	
	Characteristic.UVIndex.UUID = '05ba0fe0-b848-4226-906d-5b64272e05ce';

	Characteristic.AirPressure = function() {
		Characteristic.call(this, 'Air Pressure', 'E863F10F-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			unit: "hPa",
			maxValue: 1100,
			minValue: 700,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY]
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.AirPressure, Characteristic);	
	Characteristic.AirPressure.UUID = 'E863F10F-079E-48FF-8F27-9C2605A29F52';
	
	Characteristic.NotificationCode = function() {
		Characteristic.call(this, 'Notification Code', '381C47A3-CB06-4177-8E3D-A1B4C22EB031');
		this.setProps({
		  format:   Characteristic.Formats.UINT8,
		  maxValue: 255,
		  minValue: 0,
		  minStep: 1,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.NotificationCode.UUID = '381C47A3-CB06-4177-8E3D-A1B4C22EB031';
	inherits(Characteristic.NotificationCode, Characteristic);

	Characteristic.NotificationText = function() {
		Characteristic.call(this, 'Label', 'E244CA80-813E-423A-86BD-02F293B857A0');
		this.setProps({
		  format:   Characteristic.Formats.STRING,
		  perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY ]
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.NotificationText.UUID = 'E244CA80-813E-423A-86BD-02F293B857A0';
	inherits(Characteristic.NotificationText, Characteristic);	

	/**
	 * Custom Service 'Power Monitor'
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

	/**
	 * Custom Service 'Notification Service'
	 */
	 
	Service.NotificationService = function (displayName, subtype) {
		Service.call(this, displayName, '074D8CE9-5B4B-48D5-9990-D98850C2F3FE', subtype);

		// Required Characteristics
		/*this.addCharacteristic(Characteristic.NotificationCode);*/
		this.addCharacteristic(Characteristic.NotificationText);

		// Optional Characteristics
		this.addOptionalCharacteristic(Characteristic.Name);
	};
	inherits(Service.NotificationService, Service);	
	Service.NotificationService.UUID = '074D8CE9-5B4B-48D5-9990-D98850C2F3FE';
	
	// End of custom Services and Characteristics	
}

// -- JeedomBridgedAccessory
// -- Desc : Bridged Class, used by Homebridge to construct the Bridged platform object
// -- Params --
// -- services : Services of the Accessory
// -- Return : nothing
function JeedomBridgedAccessory(services) {
	this.services = services;
}

// -- initAccessory
// -- Desc : setting the main Characteristic of the Accessory (Manufacturer, ...) and adding services
// -- Params --
// -- newAccessory : the Accessory to add the services to
// -- Return : nothing
JeedomBridgedAccessory.prototype.initAccessory = function(newAccessory) {
	newAccessory
	   .getService(Service.AccessoryInformation)
		.setCharacteristic(Characteristic.Manufacturer, this.manufacturer)
		.setCharacteristic(Characteristic.Model, this.model)
		.setCharacteristic(Characteristic.SerialNumber, this.serialNumber);

	this.addServices(newAccessory,this.services,[]);
};

// -- addServices
// -- Desc : adding the services to the accessory and rebind event if needed
// -- Params --
// -- newAccessory : accessory to add the services too
// -- services : services to be added
// -- Return : nothing
JeedomBridgedAccessory.prototype.addServices = function(newAccessory,services,cachedValues) {
	var service;
	try {
		var cachedValue, characteristic;
		for (var s = 0; s < services.length; s++) {
			service = services[s];
			
			if(!newAccessory.getService(service.controlService)){// not exist ?
				this.log('info',' Ajout service :'+service.controlService.displayName+' subtype:'+service.controlService.subtype+' cmd_id:'+service.controlService.cmd_id+' UUID:'+service.controlService.UUID);
				newAccessory.addService(service.controlService);
				for (var i = 0; i < service.characteristics.length; i++) {
					characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
					
					cachedValue = cachedValues[service.controlService.subtype+characteristic.displayName];
					if(cachedValue != undefined && cachedValue != null){
						characteristic.setValue(sanitizeValue(cachedValue,characteristic), undefined, 'fromCache');
					}
					
					characteristic.props.needsBinding = true;
					/*if (characteristic.UUID == Characteristic.CurrentAmbientLightLevel.UUID) {
						characteristic.props.maxValue = 1000;
						characteristic.props.minStep = 1;
						characteristic.props.minValue = 1;
					}*/
					if (characteristic.UUID == Characteristic.CurrentTemperature.UUID) {
						characteristic.props.minValue = -50;
						characteristic.props.minStep = 0.01;
					}
					this.platform.bindCharacteristicEvents(characteristic, service.controlService);
					this.log('info','    Caractéristique :'+characteristic.displayName+' valeur initiale:'+characteristic.value);
				}
			}
			else
				this.log('debug','On essaye d\'ajouter un service mais il existe déjà : ',service.controlService);
		}
	}
	catch(e){
		this.log('error','Erreur de la fonction addServices :',e,JSON.stringify(service.controlService));
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [newAccessory]);
		hasError=true;
	}
};

// -- delServices
// -- Desc : deleting the services from the accessory
// -- Params --
// -- accessory : accessory to delete the services from
// -- Return : nothing
JeedomBridgedAccessory.prototype.delServices = function(accessory) {
	var service;
	try {
			var serviceList=[];
			var cachedValues=[];
			for(var t=0; t< accessory.services.length;t++) { 
				if(accessory.services[t].UUID != Service.AccessoryInformation.UUID && 
				   accessory.services[t].UUID != Service.BridgingState.UUID)
					serviceList.push(accessory.services[t]);
			}		
			for(service of serviceList){ // dont work in one loop or with temp object :(
				this.log('info',' Suppression service :'+service.displayName+' subtype:'+service.subtype+' UUID:'+service.UUID);
				for (const c of service.characteristics) {
					this.log('info','    Caractéristique :'+c.displayName+' valeur cache:'+c.value);
					cachedValues[service.subtype+c.displayName]=c.value;
				}
				accessory.removeService(service);
			}
			return cachedValues;
	}
	catch(e){
		this.log('error','Erreur de la fonction delServices :',e,JSON.stringify(service));
		console.error(e.stack);
		this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [accessory]);
		hasError=true;
	}
};

// -- hexToR
// -- Desc : take the R value in a html color string
// -- Params --
// -- h : html color string
// -- Return : R value
function hexToR(h) {
	return parseInt((cutHex(h)).substring(0, 2), 16);
}

// -- hexToG
// -- Desc : take the G value in a html color string
// -- Params --
// -- h : html color string
// -- Return : G value
function hexToG(h) {
	return parseInt((cutHex(h)).substring(2, 4), 16);
}

// -- hexToB
// -- Desc : take the B value in a html color string
// -- Params --
// -- h : html color string
// -- Return : B value
function hexToB(h) {
	return parseInt((cutHex(h)).substring(4, 6), 16);
}

// -- cutHex
// -- Desc : trim the #
// -- Params --
// -- h : html color string
// -- Return : numeric value of html color
function cutHex(h) {
	return (h.charAt(0) == '#') ? h.substring(1, 7) : h;
}

// -- rgbToHex
// -- Desc : transform separated R G B into html color
// -- Params --
// -- R : Red value
// -- G : Green value
// -- B : Blue value
// -- Return : html color
function rgbToHex(R, G, B) {
	return '#' + toHex(R) + toHex(G) + toHex(B);
}

// -- toHex
// -- Desc : Transform to hex
// -- Params --
// -- n : number
// -- Return : hex value
function toHex(n) {
	n = parseInt(n, 10);
	if (isNaN(n))
		return '00';
	n = Math.max(0, Math.min(n, 255));
	return '0123456789ABCDEF'.charAt((n - n % 16) / 16) + '0123456789ABCDEF'.charAt(n % 16);
}

// -- HSVtoRGB
// -- Desc : Transofrm HSV to RGB
// -- Params --
// -- hue : Hue value
// -- saturation : Saturation value
// -- value : value (brightness) value
// -- Return : RGB object
function HSVtoRGB(hue, saturation, value) {
	var h = hue / 360.0;
	var s = saturation / 100.0;
	var v = value / 100.0;
	var r, g, b, i, f, p, q, t;
	if (arguments.length === 1) {
		s = h.s;
		v = h.v;
		h = h.h;
	}
	i = Math.floor(h * 6);
	f = h * 6 - i;
	p = v * (1 - s);
	q = v * (1 - f * s);
	t = v * (1 - (1 - f) * s);
	switch (i % 6) {
	case 0:
		r = v;
		g = t;
		b = p;
		break;
	case 1:
		r = q;
		g = v;
		b = p;
		break;
	case 2:
		r = p;
		g = v;
		b = t;
		break;
	case 3:
		r = p;
		g = q;
		b = v;
		break;
	case 4:
		r = t;
		g = p;
		b = v;
		break;
	case 5:
		r = v;
		g = p;
		b = q;
		break;
	}
	return {
		r : Math.round(r * 255),
		g : Math.round(g * 255),
		b : Math.round(b * 255)
	};
}

// -- RGBtoHSV
// -- Desc : Transofrm RGB to HSV
// -- Params --
// -- r : Red value
// -- g : Green value
// -- b : Blue value
// -- Return : HSV object
function RGBtoHSV(r, g, b) {
	if (arguments.length === 1) {
		r = r.r;
		g = r.g;
		b = r.b;
	}
	var max = Math.max(r, g, b);
	var min = Math.min(r, g, b);
	var d = max - min;
	var h;
	var s = (max === 0 ? 0 : d / max);
	var v = max / 255;

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
