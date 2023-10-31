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
/* jshint esversion: 11,node: true,-W041: false */
'use strict';

let Access, Accessory, Service, Characteristic, AdaptiveLightingController, UUIDGen;
const fs = require('fs');
const inherits = require('util').inherits;
const myLogger = require('./lib/myLogger').myLogger;
const debug = {};
debug.DEBUG = 100;
debug.INFO = 200;
debug.WARN = 300;
debug.ERROR = 400;
debug.NO = 1000;
let hasError = false;
let FakeGatoHistoryService;
let DEV_DEBUG=false;
const GenericAssociated = ['GENERIC_INFO','SHOCK','RAIN_CURRENT','RAIN_TOTAL','WIND_SPEED','WIND_DIRECTION','MODE_STATE'];
const PushButtonAssociated = ['PUSH_BUTTON','CAMERA_UP','CAMERA_DOWN','CAMERA_LEFT','CAMERA_RIGHT','CAMERA_ZOOM','CAMERA_DEZOOM','CAMERA_PRESET','FLAP_UP','FLAP_DOWN','FLAP_STOP'];

module.exports = function(homebridge) {
	Accessory = homebridge.platformAccessory;
	Service = homebridge.hap.Service;
	Characteristic = homebridge.hap.Characteristic;
	Access = homebridge.hap.Access;
	AdaptiveLightingController = homebridge.hap.AdaptiveLightingController;
	UUIDGen = homebridge.hap.uuid;
	FakeGatoHistoryService = require('fakegato-history')(homebridge);
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
		if(config.debugLevel == 0) {
			config.debugLevel = 100;
			DEV_DEBUG = true;
		}
		this.debugLevel = config.debugLevel || debug.ERROR;
		let logPath = api.user.storagePath()+'/../../../../log/'
		if (!fs.existsSync(logPath)) {
			logPath = '/tmp/'
		}
		this.log = myLogger.createMyLogger(this.debugLevel,logger,logPath);
		this.log('debugLevel:'+this.debugLevel);
		this.myPlugin = config.myPlugin;
		this.adaptiveEnabled = config.adaptiveEnabled;
		
		this.pathHomebridgeConf = api.user.storagePath()+'/';
		
		this.fakegato=false;
		if(config.fakegato==true) {
			this.fakegato=true;
		}
		
		if (!config.url || 
			config.url == "http://:80" ||
			config.url == 'https://:80') {
			this.log('error',"Adresse Jeedom non configurée, Veuillez la configurer avant de relancer.");
			process.exit(1);
		} else if(config.url.indexOf('https') !== -1) {
			process.env.NODE_TLS_REJECT_UNAUTHORIZED = 0;
			this.log('error',"Adresse Jeedom utilise https en interne, non supporté mais on essaie :"+config.url);	
			// process.exit(1);
		} else {
			this.log('info',"Adresse Jeedom bien configurée :"+config.url);	
		}
		this.DEV_DEBUG = DEV_DEBUG; // for passing by
		this.jeedomClient = require('./lib/jeedom-api').createClient(config.url, config.apikey, this, config.myPlugin);
		this.rooms = {};
		this.updateSubscriptions = [];
		
		this.lastPoll = 0;
		this.pollingUpdateRunning = false;
		this.pollingID = null;
		this.settingLight = false;
		this.settingFan = false;
		
		this.pollerPeriod = config.pollerperiod;
		if ( typeof this.pollerPeriod === 'string') {
			this.pollerPeriod = parseInt(this.pollerPeriod);
		} else if (!this.pollerPeriod) {
			this.pollerPeriod = 0.05; // 0.05 is Nice between 2 calls
		}
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
		const that = this;
		that.log('Synchronisation Jeedom <> Homebridge...');
		that.jeedomClient.getModel()
			.then(function(model){ // we got the base Model from the API
				if(model && typeof model === 'object' && model.config && typeof model.config === 'object' && model.config.datetime) {
					that.lastPoll=model.config.datetime;
					
					that.log('debug','Enumération des objets Jeedom (Pièces)...');
					if(model.objects && typeof model.objects === 'object' && Object.keys(model.objects).length !== 0) {
						model.objects.map(function(r){
							that.rooms[r.id] = r.name;
							that.log('debug','Pièce > ' + r.name);
						});
					} else {
						that.log('error','Pièce > '+model.objects);
						throw new Error('Rooms list empty or invalid');
					}

					that.log('Enumération des scénarios Jeedom...');
					that.JeedomScenarios2HomeKitAccessories(model.scenarios);
					
					that.log('Enumération des périphériques Jeedom...');
					if(model.eqLogics && typeof model.eqLogics === 'object' && Object.keys(model.eqLogics).length !== 0) {
						that.JeedomDevices2HomeKitAccessories(model.eqLogics);
					} else {
						that.log('error','Périf > '+model.eqLogics);
						throw new Error('eqLogics list empty');	
					}
				} else {
					that.log('error','Model invalide > ',model);
					throw new Error('Invalid Model');
				}
			}).catch(function(err) {
				that.log('error','#2 Erreur de récupération des données Jeedom: ' , err);
				if(err && err.stack) { console.error(err.stack); }
			});
	}
	catch(e){
		this.log('error','Erreur de la fonction addAccessories :',e);
		console.error(e.stack);
	}
};

JeedomPlatform.prototype.JeedomScenarios2HomeKitAccessories = function(scenarios) {
	try{
		const that = this;
		if (scenarios) {
			scenarios.sort(function compare(a, b) {
				// reorder by room name asc and name asc
				const aC = that.rooms[a.object_id]+a.name;
				const bC = that.rooms[b.object_id]+b.name;
				if (aC > bC) {
					return 1;
				}
				if (aC < bC) {
					return -1;
				}
				return 0;
			});

			scenarios.map(function(scenario) {
				if (scenario.isActive == '1' &&
					scenario.object_id != null && 
					scenario.sendToHomebridge == '1') {

					that.log('debug','Scenario > '+JSON.stringify(scenario).replace("\n",''));
					that.log('┌──── ' + that.rooms[scenario.object_id] + ' > ' +scenario.name+' ('+scenario.id+')');
					

					const HBservice = {
						controlService : new Service.Switch(scenario.name),
						characteristics : [Characteristic.On],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=scenario;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.scenario=scenario;

							
					Serv.cmd_id = scenario.id;
					Serv.eqID = scenario.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = scenario.id + '-' + Serv.subtype;

					if(that.fakegato && !scenario.hasLogging) {
						// HBservice.characteristics.push(Characteristic.Sensitivity,Characteristic.Duration,Characteristic.LastActivation);

						// eqLogic.loggingService = {type:"motion", options:{storage:'googleDrive',folder:'fakegato',keyPath:'/home/pi/.homebridge/'},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						scenario.loggingService = {type:"switch", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};

						scenario.hasLogging=true;
					}

					scenario.eqType_name = "Scenario";
					scenario.logicalId = "";
					
					const createdAccessory = that.createAccessory([HBservice], scenario);
					that.addAccessory(createdAccessory);
					that.log('└─────────');
					
				}
				else
				{
					that.log('debug','Scenario > '+JSON.stringify(scenario).replace("\n",''));
					that.log('┌──── ' + that.rooms[scenario.object_id] + ' > ' +scenario.name+' ('+scenario.id+')');
					var Messg= '│ Scenario ';
					Messg += scenario.isVisible == '1' ? 'visible' : 'invisible';
					Messg += scenario.isActive == '1' ? ', activé' : ', désactivé';
					Messg += scenario.object_id != null ? '' : ', pas dans une pièce';
					Messg += scenario.sendToHomebridge == '1' ? '' : ', pas coché pour Homebridge';
					that.log(Messg);

					scenario.eqType_name = "Scenario";
					scenario.logicalId = "";
					
					that.delAccessory(
						that.createAccessory([], scenario) // create a cached lookalike object for unregistering it
					);
					that.log('└─────────');
				}
				
			});
			
		}
	} 
	catch(e) {
		this.log('error','Erreur de la fonction JeedomScenarios2HomeKitAccessories :',e);
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
		const that = this;
		if (devices) {
			devices.sort(function compare(a, b) {
				// reorder by room name asc and name asc
				const aC = that.rooms[a.object_id]+a.name;
				const bC = that.rooms[b.object_id]+b.name;
				if (aC > bC) {
					return 1;
				}
				if (aC < bC) {
					return -1;
				}
				return 0;
			});
			
			devices.map(function(device) {
				if (// device.isVisible == '1' && 
					device.isEnable == '1' &&
					device.object_id != null && 
					device.sendToHomebridge != '0') {

					that.AccessoireCreateHomebridge(
						that.jeedomClient.ParseGenericType(
							device, 
							that.jeedomClient.getDeviceCmdFromCache(device.id)
						)
					);
				}
				else
				{
					that.log('debug','eqLogic > '+JSON.stringify(device).replace("\n",''));
					that.log('┌──── ' + that.rooms[device.object_id] + ' > ' +device.name+((device.pseudo)?' > pseudo: '+device.pseudo:'')+' ('+device.id+')');
					var Messg= '│ Accessoire ';
					Messg += device.isVisible == '1' ? 'visible' : 'invisible';
					Messg += device.isEnable == '1' ? ', activé' : ', désactivé';
					Messg += device.object_id != null ? '' : ', pas dans une pièce';
					Messg += device.sendToHomebridge != '0' ? '' : ', pas coché pour Homebridge';
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
			for (const a in that.accessories) 
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
						that.accessories[a].displayName) {countA++;}
				}
			}
			if(!hasDeleted) {that.log('│ Rien à supprimer');}
			that.log('└────────────────────────');
		}
		else
		{
			that.log('error','!!! ERREUR DETECTÉE, ON QUITTE HOMEBRIDGE !!!');
			process.exit(1);
		}
		const endLog = '--== Homebridge est démarré et a intégré '+countA+' accessoire'+ (countA>1 ? 's' : '') +' ! (Si vous avez un Warning Avahi, ne pas en tenir compte) ==--';
		that.log(endLog);
		if(countA >= 150) {that.log('error','!!! ATTENTION !!! Vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 150 max au total !!');}
		else if(countA >= 140) {that.log('warn','!! Avertissement, vous avez '+countA+' accessoires + Jeedom et HomeKit en supporte 150 max au total !!');}
		
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
		const that = this;
		var HBservices = [];
		var HBservice = null;	
		const eqServicesCopy = eqLogic.services;
		that.log('debug','eqLogic > '+JSON.stringify(eqLogic).replace("\n",''));
		that.log('┌──── ' + that.rooms[eqLogic.object_id] + ' > ' + eqLogic.name +((eqLogic.pseudo)?' > pseudo: '+eqLogic.pseudo:'')+ ' (' + eqLogic.id + ')');
		eqLogic.origName=eqLogic.name;
		if(eqLogic.pseudo) {
			eqLogic.name = eqLogic.pseudo;
		}
		if (eqLogic.services.light) {
			eqLogic.services.light.forEach(function(cmd) {
				if (cmd.state) {
					let LightType="Switch";
					HBservice = {
						controlService : new Service.Lightbulb(eqLogic.name),
						characteristics : [Characteristic.On],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					if(eqLogic.OnAfterBrightness) {Serv.OnAfterBrightness=true;}
					if(eqLogic.ignoreOnCommandOnBrightnessChange) {Serv.ignoreOnCommandOnBrightnessChange=true;}

					eqServicesCopy.light.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on=cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off=cmd2.off;
						} else if (cmd2.slider) {
							Serv.actions.slider=cmd2.slider;
						} else if (cmd2.setcolor) {
							Serv.actions.setcolor=cmd2.setcolor;
						} else if (cmd2.setcolor_temp) {
							Serv.actions.setcolor_temp=cmd2.setcolor_temp;
						} else if (cmd2.color) {
							Serv.infos.color=cmd2.color;
						} else if (cmd2.color_temp) {
							Serv.infos.color_temp=cmd2.color_temp;
						} else if (cmd2.state_bool) {
							Serv.infos.state_bool=cmd2.state_bool;
						} else if (cmd2.brightness) {
							Serv.infos.brightness=cmd2.brightness;
						}
					});
					if (Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique "Action/Lumière OFF"');}
					if (!Serv.actions.on && Serv.actions.off) {that.log('warn','Pas de type générique "Action/Lumière ON"');}
					if (!Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique "Action/Lumière ON" et "Action/Lumière OFF"');}
					if (Serv.infos.color && !Serv.actions.setcolor) {that.log('warn','Pas de type générique "Action/Lumière Couleur"');}
					if (!Serv.infos.color && Serv.actions.setcolor) {that.log('warn','Pas de type générique "Info/Lumière Couleur"');}
					if (Serv.infos.color_temp && !Serv.actions.setcolor_temp) {that.log('warn','Pas de type générique "Action/Lumière Température Couleur"');}
					if (!Serv.infos.color_temp && Serv.actions.setcolor_temp) {that.log('warn','Pas de type générique "Info/Lumière Température Couleur"');}
					
					if(Serv.actions.slider) {
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.maxValue && parseInt(Serv.actions.slider.configuration.maxValue)) {
							Serv.maxBright = parseInt(Serv.actions.slider.configuration.maxValue);
						} else {
							Serv.maxBright = 100; // if not set in Jeedom it's 100
						}
						LightType += '_Slider,'+Serv.maxBright;
						HBservice.characteristics.push(Characteristic.Brightness);
						Serv.addCharacteristic(Characteristic.Brightness);
					} else {
						that.log('info','La lumière n\'a pas de variateur');
					}
					if(Serv.infos.color) {
						LightType += "_RGB";
						HBservice.characteristics.push(Characteristic.Hue);
						Serv.addCharacteristic(Characteristic.Hue);
						HBservice.characteristics.push(Characteristic.Saturation);
						Serv.addCharacteristic(Characteristic.Saturation);
						Serv.HSBValue = {
							hue : 0,
							saturation : 0,
							brightness : 0,
						};
						Serv.RGBValue = {
							red : 0,
							green : 0,
							blue : 0,
						};
						// Serv.countColorCharacteristics = 0;
						Serv.timeoutIdColorCharacteristics = 0;
					}
					if(Serv.infos.color_temp) {
						LightType += "_Temp";
						const props = {};
						
						if(Serv.actions.setcolor_temp && Serv.actions.setcolor_temp.configuration && Serv.actions.setcolor_temp.configuration.maxValue && Serv.actions.setcolor_temp.configuration.minValue && parseInt(Serv.actions.setcolor_temp.configuration.maxValue) && parseInt(Serv.actions.setcolor_temp.configuration.minValue)) {
							if(parseInt(Serv.actions.setcolor_temp.configuration.maxValue) > 500 && parseInt(Serv.actions.setcolor_temp.configuration.minValue) > 500) { // Kelvin
								// convert to Mired (and take the max value to the min)
								props.minValue = parseInt(1000000/Serv.actions.setcolor_temp.configuration.maxValue);
								props.maxValue = parseInt(1000000/Serv.actions.setcolor_temp.configuration.minValue);
								Serv.colorTempType="kelvin";
								LightType+=Serv.colorTempType;
							} else { // already mired
								props.minValue = parseInt(Serv.actions.setcolor_temp.configuration.minValue);
								props.maxValue = parseInt(Serv.actions.setcolor_temp.configuration.maxValue);
								Serv.colorTempType="mired";
								LightType+=Serv.colorTempType;
							}
						} else {
							that.log('error','"Action/Lumière Température Couleur" doit avoir un minimum et un maximum !');
							props.minValue = 0; // if not set in Jeedom it's 0
							props.maxValue = 20000; // if not set in Jeedom it's 100
						}
						const unite = Serv.infos.color_temp.unite ? Serv.infos.color_temp.unite : '';
						if(unite) {props.unit=unite;}
						HBservice.characteristics.push(Characteristic.ColorTemperature);
						Serv.addCharacteristic(Characteristic.ColorTemperature);
						Serv.getCharacteristic(Characteristic.ColorTemperature).setProps(props);
					}

					if(eqLogic.hasAdaptive) {
						if (that.adaptiveLightingSupport()) {
							LightType+='_Adaptive';
						} else {
							eqLogic.hasAdaptive=false;
						}
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					that.log('info','La lumière est du type :',LightType);
					Serv.LightType = LightType;
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Lumière Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.flap) {
			eqLogic.services.flap.forEach(function(cmd) {
				if (cmd.state || cmd.stateClosing) {
					HBservice = {
						controlService : new Service.WindowCovering(eqLogic.name),
						characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					if(cmd.stateClosing) {
						Serv.infos.state=cmd.stateClosing;
						if(Serv.infos.state.subType == 'binary') {
							if(Serv.infos.state.display && Serv.infos.state.display.invertBinary) {
								Serv.FlapType="Opening";
							} else {
								Serv.FlapType="Closing";
							}
						} else {
							Serv.FlapType="Closing";
						}
					} else if(cmd.state) {
						Serv.infos.state=cmd.state;
						if(Serv.infos.state.subType == 'binary') {
							if(Serv.infos.state.display && Serv.infos.state.display.invertBinary) {
								Serv.FlapType="Closing";
							} else {
								Serv.FlapType="Opening";
							}
						} else {
							Serv.FlapType="Opening";
						}
					}

					eqServicesCopy.flap.forEach(function(cmd2) {
						if (cmd2.up) {
							Serv.actions.up = cmd2.up;
						} else if (cmd2.down) {
							Serv.actions.down = cmd2.down;
						} else if (cmd2.slider) {
							Serv.actions.slider = cmd2.slider;
						} else if (cmd2.HorTiltSlider) {
							Serv.actions.HorTiltSlider = cmd2.HorTiltSlider;
						} else if (cmd2.VerTiltSlider) {
							Serv.actions.VerTiltSlider = cmd2.VerTiltSlider;
						} else if (cmd2.HorTiltState) {
							Serv.infos.HorTiltState = cmd2.HorTiltState;
						} else if (cmd2.VerTiltState) {
							Serv.infos.VerTiltState = cmd2.VerTiltState;
						}
					});
					if(Serv.actions.up && !Serv.actions.down) {that.log('warn','Pas de type générique "Action/Volet Bouton Descendre"');}
					if(!Serv.actions.up && Serv.actions.down) {that.log('warn','Pas de type générique "Action/Volet Bouton Monter"');}
					if(!Serv.actions.up && !Serv.actions.down) {that.log('warn','Pas de type générique "Action/Volet Bouton Descendre" et "Action/Volet Bouton Monter"');}
					if(!Serv.actions.up && !Serv.actions.down && !Serv.actions.slider) {that.log('warn','Pas de type générique "Action/Volet Bouton Slider" et "Action/Volet Bouton Monter" et "Action/Volet Bouton Descendre"');}
					if(Serv.actions.HorTiltSlider && !Serv.infos.HorTiltState) {that.log('warn','Pas de type générique "Info/Volet Etat Inclinaison Horizontale" malgré l\'action "Action/Volet Slider Inclinaison Horizontale"');}
					if(Serv.actions.VerTiltSlider && !Serv.infos.VerTiltState) {that.log('warn','Pas de type générique "Info/Volet Etat Inclinaison Verticale" malgré l\'action "Action/Volet Slider Inclinaison Verticale"');}
					if(!Serv.actions.HorTiltSlider && Serv.infos.HorTiltState) {that.log('warn','Pas de type générique "Action/Volet Slider Inclinaison Horizontale" malgré l\'état "Info/Volet Etat Inclinaison Horizontale"');}
					if(!Serv.actions.VerTiltSlider && Serv.infos.VerTiltState) {that.log('warn','Pas de type générique "Action/Volet Slider Inclinaison Verticale" malgré l\'état "Info/Volet Etat Inclinaison Verticale"');}
					Serv.minValue=0;
					if(Serv.infos.state.subType == 'binary') {
						Serv.maxValue=1;
						Serv.getCharacteristic(Characteristic.TargetPosition).setProps({minStep:100});
					} else {
						Serv.maxValue=100;	
					}
					if(Serv.actions.slider) {
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.maxValue && parseInt(Serv.actions.slider.configuration.maxValue)) {
							Serv.maxValue = parseInt(Serv.actions.slider.configuration.maxValue);
						}
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.minValue && parseInt(Serv.actions.slider.configuration.minValue)) {
							Serv.minValue = parseInt(Serv.actions.slider.configuration.minValue);
						}
					}
					if(Serv.actions.HorTiltSlider) {
						const props = {};
						if(Serv.actions.HorTiltSlider.configuration && Serv.actions.HorTiltSlider.configuration.maxValue && parseInt(Serv.actions.HorTiltSlider.configuration.maxValue)) {
							props.maxValue = parseInt(Serv.actions.HorTiltSlider.configuration.maxValue);
						} else {
							props.maxValue = 90;
						}
						if(Serv.actions.HorTiltSlider.configuration && Serv.actions.HorTiltSlider.configuration.minValue && parseInt(Serv.actions.HorTiltSlider.configuration.minValue)) {
							props.minValue = parseInt(Serv.actions.HorTiltSlider.configuration.minValue);
						} else {
							props.minValue = 0;
						}
						HBservice.characteristics.push(Characteristic.CurrentHorizontalTiltAngle);
						Serv.addCharacteristic(Characteristic.CurrentHorizontalTiltAngle);
						Serv.getCharacteristic(Characteristic.CurrentHorizontalTiltAngle).setProps(props);
						
						HBservice.characteristics.push(Characteristic.TargetHorizontalTiltAngle);
						Serv.addCharacteristic(Characteristic.TargetHorizontalTiltAngle);
						Serv.getCharacteristic(Characteristic.TargetHorizontalTiltAngle).setProps(props);
						that.log('debug','Horizontal Slider props :'+JSON.stringify(props)+'/'+JSON.stringify(Serv.actions.HorTiltSlider.configuration));
					}
					
					if(Serv.actions.VerTiltSlider) {
						const props = {};
						if(Serv.actions.VerTiltSlider.configuration && Serv.actions.VerTiltSlider.configuration.maxValue && parseInt(Serv.actions.VerTiltSlider.configuration.maxValue)) {
							props.maxValue = parseInt(Serv.actions.VerTiltSlider.configuration.maxValue);
						} else {
							props.maxValue = 90;
						}
						if(Serv.actions.VerTiltSlider.configuration && Serv.actions.VerTiltSlider.configuration.minValue && parseInt(Serv.actions.VerTiltSlider.configuration.minValue)) {
							props.minValue = parseInt(Serv.actions.VerTiltSlider.configuration.minValue);
						} else {
							props.minValue = 0;
						}	
						HBservice.characteristics.push(Characteristic.CurrentVerticalTiltAngle);
						Serv.addCharacteristic(Characteristic.CurrentVerticalTiltAngle);
						Serv.getCharacteristic(Characteristic.CurrentVerticalTiltAngle).setProps(props);
						
						HBservice.characteristics.push(Characteristic.TargetVerticalTiltAngle);
						Serv.addCharacteristic(Characteristic.TargetVerticalTiltAngle);
						Serv.getCharacteristic(Characteristic.TargetVerticalTiltAngle).setProps(props);
						that.log('debug','Vertical Slider props :'+JSON.stringify(props)+'/'+JSON.stringify(Serv.actions.VerTiltSlider.configuration));
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = Serv.infos.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;

					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Volet Etat" ou "Info/Volet Etat Fermeture" on regarde s\'il y a uniquement les boutons...');
				eqLogic.services.flap.forEach(function(cmd) {
					if (cmd.up) {
						const SwitchName=cmd.up.name;
						HBservice = {
							controlService : new Service.Switch(SwitchName),
							characteristics : [Characteristic.On],
						};
						const Serv = HBservice.controlService;
						Serv.eqLogic=eqLogic;
						Serv.actions={};
						Serv.infos={};
						Serv.actions.Push = cmd.up;
						Serv.getCharacteristic(Characteristic.On).displayName = SwitchName;
						
						Serv.ConfiguredName=SwitchName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SwitchName);
						
						// add Active, Tampered and Defect Characteristics if needed
						HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
						
						Serv.cmd_id = cmd.up.id;
						Serv.eqID = eqLogic.id;
						Serv.subtype = Serv.subtype || '';
						Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
						HBservices.push(HBservice);
					}
					if (cmd.down) {
						const SwitchName=cmd.down.name;
						HBservice = {
							controlService : new Service.Switch(SwitchName),
							characteristics : [Characteristic.On],
						};
						const Serv = HBservice.controlService;
						Serv.eqLogic=eqLogic;
						Serv.actions={};
						Serv.infos={};
						Serv.actions.Push = cmd.down;
						Serv.getCharacteristic(Characteristic.On).displayName = SwitchName;
						
						Serv.ConfiguredName=SwitchName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SwitchName);
						
						// add Active, Tampered and Defect Characteristics if needed
						HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
						
						Serv.cmd_id = cmd.down.id;
						Serv.eqID = eqLogic.id;
						Serv.subtype = Serv.subtype || '';
						Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
						HBservices.push(HBservice);
					}
					if (cmd.stop) {
						const SwitchName=cmd.stop.name;
						HBservice = {
							controlService : new Service.Switch(SwitchName),
							characteristics : [Characteristic.On],
						};
						const Serv = HBservice.controlService;
						Serv.eqLogic=eqLogic;
						Serv.actions={};
						Serv.infos={};
						Serv.actions.Push = cmd.stop;
						Serv.getCharacteristic(Characteristic.On).displayName = SwitchName;
						
						Serv.ConfiguredName=SwitchName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SwitchName);
						
						// add Active, Tampered and Defect Characteristics if needed
						HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
						
						Serv.cmd_id = cmd.stop.id;
						Serv.eqID = eqLogic.id;
						Serv.subtype = Serv.subtype || '';
						Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
						HBservices.push(HBservice);
					}
				});
				if(!HBservice) {
					that.log('warn','Pas de type générique "Action/Volet Bouton Monter" ou "Action/Volet Bouton Descendre" ou "Action/Volet Bouton Stop"');
				} else {
					HBservice = null;
				}
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.windowMoto) {
			eqLogic.services.windowMoto.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Window(eqLogic.name),
						characteristics : [Characteristic.CurrentPosition, Characteristic.TargetPosition, Characteristic.PositionState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;

					eqServicesCopy.windowMoto.forEach(function(cmd2) {
						if (cmd2.up) {
							Serv.actions.up = cmd2.up;
						} else if (cmd2.down) {
							Serv.actions.down = cmd2.down;
						} else if (cmd2.slider) {
							Serv.actions.slider = cmd2.slider;
						}
					});
					Serv.maxValue = 100; // if not set in Jeedom it's 100
					Serv.minValue = 0; // if not set in Jeedom it's 0
					if(Serv.actions.up && !Serv.actions.down) {that.log('warn','Pas de type générique "Action/Fenêtre Motorisée Descendre"');}
					if(!Serv.actions.up && Serv.actions.down) {that.log('warn','Pas de type générique "Action/Fenêtre Motorisée Monter"');}
					if(!Serv.actions.up && !Serv.actions.down) {that.log('warn','Pas de type générique "Action/Fenêtre Motorisée Descendre" et "Action/Fenêtre Motorisée Monter"');}
					if(!Serv.actions.up && !Serv.actions.down && !Serv.actions.slider) {that.log('warn','Pas de type générique "Action/Fenêtre Motorisée Slider" et "Action/Fenêtre Motorisée Monter" et "Action/Fenêtre Motorisée Descendre"');}
					if(Serv.actions.slider) {
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.maxValue && parseInt(Serv.actions.slider.configuration.maxValue)) {
							Serv.maxValue = parseInt(Serv.actions.slider.configuration.maxValue);
						}
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.minValue && parseInt(Serv.actions.slider.configuration.minValue)) {
							Serv.minValue = parseInt(Serv.actions.slider.configuration.minValue);
						}
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;

					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Fenêtre Motorisée Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.energy) {
			eqLogic.services.energy.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Outlet(eqLogic.name),
						characteristics : [Characteristic.On, Characteristic.OutletInUse],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.energy.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						} else if (cmd2.inuse) {
							Serv.infos.inuse = cmd2.inuse;
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Prise Bouton On"');}
					if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Prise Bouton Off"');}
					// Test for AdminOnlyAccess, state need to have OwnerOnly attribute to True ou 1
					if(Serv.infos.state.OwnerOnly) {Serv.getCharacteristic(Characteristic.On).setProps({adminOnlyAccess: [Access.WRITE]});}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Prise Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.faucet) {
			eqLogic.services.faucet.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Valve(eqLogic.name),
						characteristics : [Characteristic.Active,Characteristic.InUse,Characteristic.ValveType],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					Serv.getCharacteristic(Characteristic.ValveType).setValue(Characteristic.ValveType.WATER_FAUCET);
					Serv.ValveType=Characteristic.ValveType.WATER_FAUCET;
					eqServicesCopy.faucet.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Robinet Bouton On"');}
					if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Robinet Bouton Off"');}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Robinet Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.irrigation) {
			eqLogic.services.irrigation.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Valve(eqLogic.name),
						characteristics : [Characteristic.Active,Characteristic.InUse,Characteristic.ValveType],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					Serv.getCharacteristic(Characteristic.ValveType).setValue(Characteristic.ValveType.IRRIGATION);
					Serv.ValveType=Characteristic.ValveType.IRRIGATION;
					eqServicesCopy.irrigation.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Irrigation Bouton On"');}
					if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Irrigation Bouton Off"');}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Irrigation Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.valve) {
			eqLogic.services.valve.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.Valve(eqLogic.name),
						characteristics : [Characteristic.Active,Characteristic.InUse,Characteristic.ValveType],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					Serv.getCharacteristic(Characteristic.ValveType).setValue(Characteristic.ValveType.GENERIC_VALVE);
					Serv.ValveType=Characteristic.ValveType.GENERIC_VALVE;
					eqServicesCopy.valve.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						} else if (cmd2.setDuration) {
							Serv.actions.setDuration = cmd2.setDuration;
						} else if (cmd2.remainingDuration) {
							Serv.infos.remainingDuration = cmd2.remainingDuration;
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Valve générique Bouton On"');}
					if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Valve générique Bouton Off"');}
					
					if(Serv.actions.setDuration) {
						HBservice.characteristics.push(Characteristic.SetDuration);
						Serv.addOptionalCharacteristic(Characteristic.SetDuration);
					}
					if(Serv.infos.remainingDuration) {
						HBservice.characteristics.push(Characteristic.RemainingDuration);
						Serv.addOptionalCharacteristic(Characteristic.RemainingDuration);
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Valve générique Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.fan) {
			eqLogic.services.fan.forEach(function(cmd) {
				if (cmd.state) {
					let FanType="Switch";
					let maxPower;
					HBservice = {
						controlService : new Service.Fan(eqLogic.name),
						characteristics : [Characteristic.On],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;

					eqServicesCopy.fan.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on=cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off=cmd2.off;
						} else if (cmd2.slider) {
							Serv.actions.slider=cmd2.slider;
						}
					});
					if (Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique "Action/Ventilateur OFF"');}
					if (!Serv.actions.on && Serv.actions.off) {that.log('warn','Pas de type générique "Action/Ventilateur ON"');}
					if (!Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique "Action/Ventilateur ON" et "Action/Ventilateur OFF"');}
					
					if(Serv.actions.slider) {
						if(Serv.actions.slider.configuration && Serv.actions.slider.configuration.maxValue && parseInt(Serv.actions.slider.configuration.maxValue)) {
							maxPower = parseInt(Serv.actions.slider.configuration.maxValue);
						} else {
							maxPower = 100; // if not set in Jeedom it's 100
						}
						FanType += "_Slider";
						HBservice.characteristics.push(Characteristic.RotationSpeed);
						Serv.addCharacteristic(Characteristic.RotationSpeed);
					} else {
						that.log('info','Le ventilateur n\'a pas de variateur');
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					that.log('info','Le ventilateur est du type :',FanType+((maxPower)?','+maxPower:''));
					Serv.FanType = FanType;
					Serv.maxPower = maxPower;
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Ventilateur Etat"');
			} else {
				HBservice = null;
			}
		}		
		if (eqLogic.services.Switch) {
			eqLogic.services.Switch.forEach(function(cmd) {
				if (cmd.state) {
					let SwitchName = eqLogic.name;
					if(cmd.state.generic_type == 'CAMERA_RECORD_STATE' || (cmd.state.generic_type == 'SWITCH_STATE' && eqLogic.numSwitches>1)) {
						that.log('debug',"Switchs multiples dans même équipement, il y en a "+eqLogic.numSwitches);
						SwitchName=cmd.state.name;
					}
					HBservice = {
						controlService : new Service.Switch(SwitchName),
						characteristics : [Characteristic.On],
					};
					const Serv = HBservice.controlService;
					if(cmd.state.generic_type == 'CAMERA_RECORD_STATE' || (cmd.state.generic_type == 'SWITCH_STATE' && eqLogic.numSwitches>1)) {
						that.log('debug',"Nom du switch (multi) : "+SwitchName);
						Serv.getCharacteristic(Characteristic.On).displayName = SwitchName;
						
						Serv.ConfiguredName=SwitchName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SwitchName);
					}
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.Switch.forEach(function(cmd2) {
						if (cmd2.on) {
							if(Serv.infos.state.generic_type == 'SWITCH_STATE' && eqLogic.numSwitches>1) {
								if(cmd2.on.value == cmd.state.id) {
									Serv.actions.on = cmd2.on;
								}
							} else {
								Serv.actions.on = cmd2.on;
							}
						} else if (cmd2.off) {
							if(Serv.infos.state.generic_type == 'SWITCH_STATE' && eqLogic.numSwitches>1) {
								if(cmd2.off.value == cmd.state.id) {
									Serv.actions.off = cmd2.off;
								}
							} else {
								Serv.actions.off = cmd2.off;
							}
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Interrupteur Bouton On"');}
					if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Interrupteur Bouton Off"');}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						// HBservice.characteristics.push(Characteristic.Sensitivity,Characteristic.Duration,Characteristic.LastActivation);

						// eqLogic.loggingService = {type:"motion", options:{storage:'googleDrive',folder:'fakegato',keyPath:'/home/pi/.homebridge/'},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.loggingService = {type:"switch", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};

						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Interrupteur Etat"');
			} else {
				HBservice = null;
			}
		}	
		if (eqLogic.services.Push) {
			eqLogic.services.Push.forEach(function(cmd) {
				if (cmd.Push && cmd.Push.subType == 'other') {
					const SwitchName=cmd.Push.name;
					HBservice = {
						controlService : new Service.Switch(SwitchName),
						characteristics : [Characteristic.On,Characteristic.ConfiguredName],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.actions.Push = cmd.Push;
					Serv.getCharacteristic(Characteristic.On).displayName = SwitchName;
					
					Serv.ConfiguredName=SwitchName;
					Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SwitchName);
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.Push.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','La Commande Action associée doit être du type "Autre"');
			} else {
				HBservice = null;
			}
		}		
		if (eqLogic.services.power || (eqLogic.services.power && eqLogic.services.consumption)) {
			eqLogic.services.power.forEach(function(cmd) {
				if (cmd.power) {
					HBservice = {
						controlService : new Service.PowerMonitor(eqLogic.name),
						characteristics : [Characteristic.CurrentPowerConsumption, Characteristic.TotalPowerConsumption],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.power=cmd.power;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					if(eqServicesCopy.consumption) {
						eqServicesCopy.consumption.forEach(function(cmd2) {
							if (cmd2.consumption) {
								Serv.infos.consumption=cmd2.consumption;
							}
						});
					}
					
					Serv.cmd_id = cmd.power.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					if(that.fakegato && !eqLogic.hasLogging) {
						// HBservice.characteristics.push(Characteristic.ResetTotal);
						eqLogic.loggingService = {type:"energy", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};

						eqLogic.hasLogging=true;
					}
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
						characteristics : [Characteristic.BatteryLevel,Characteristic.ChargingState,Characteristic.StatusLowBattery],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.battery=cmd.battery;
					Serv.infos.batteryCharging=cmd.batteryCharging || {id:'NOT'};
					eqServicesCopy.battery.forEach(function(cmd2) {
						if (cmd2.batteryCharging) {
							Serv.infos.batteryCharging=cmd2.batteryCharging;
						} else {
							Serv.infos.batteryCharging={id:'NOT'};
						}
					});
					Serv.cmd_id = cmd.battery.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.Noise) {
			eqLogic.services.Noise.forEach(function(cmd) {
				if (cmd.Noise) {
					HBservice = {
						controlService : new Service.NoiseSensor(eqLogic.name),
						characteristics : [Characteristic.NoiseLevel,Characteristic.NoiseQuality],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.Noise=cmd.Noise;
					
					if(cmd.Noise.subType=='numeric') {
						Serv.levelNum=[];		
						Serv.levelNum[Characteristic.NoiseQuality.SILENT]=50;
						Serv.levelNum[Characteristic.NoiseQuality.CALM]=65;
						Serv.levelNum[Characteristic.NoiseQuality.LIGHTLYNOISY]=70;
						Serv.levelNum[Characteristic.NoiseQuality.NOISY]=80;
						Serv.levelNum[Characteristic.NoiseQuality.TOONOISY]=100;
					} else {
						Serv.levelTxt=[];		
						Serv.levelTxt[Characteristic.NoiseQuality.SILENT]="Silencieux";
						Serv.levelTxt[Characteristic.NoiseQuality.CALM]="Calme";
						Serv.levelTxt[Characteristic.NoiseQuality.LIGHTLYNOISY]="Légèrement Bruyant";
						Serv.levelTxt[Characteristic.NoiseQuality.NOISY]="Bruyant";
						Serv.levelTxt[Characteristic.NoiseQuality.TOONOISY]="Trop Bruyant";
					}
					
					Serv.cmd_id = cmd.Noise.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = 'Noise';
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					const uniteNoise = Serv.infos.Noise.unite ? Serv.infos.Noise.unite : '';
					if(uniteNoise) {
						const propsNoise = {};
						propsNoise.unit=uniteNoise;
						Serv.getCharacteristic(Characteristic.NoiseLevel).setProps(propsNoise);
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}		
		if (eqLogic.services.CO) {
			eqLogic.services.CO.forEach(function(cmd) {
				if (cmd.CO) {
					HBservice = {
						controlService : new Service.CarbonMonoxideSensor(eqLogic.name),
						characteristics : [Characteristic.CarbonMonoxideDetected],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.CO=cmd.CO;
					
					Serv.cmd_id = cmd.CO.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = 'CO';
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
										
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}			
		if (eqLogic.services.CO2) {
			eqLogic.services.CO2.forEach(function(cmd) {
				if (cmd.CO2) {
					HBservice = {
						controlService : new Service.AirQualitySensor(eqLogic.name),
						characteristics : [Characteristic.AirQuality,Characteristic.CarbonDioxideLevel,Characteristic.CarbonDioxideDetected],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.CO2=cmd.CO2;
					
					if(cmd.CO2.subType=='numeric') {
						Serv.levelNum=[];		
						Serv.levelNum[Characteristic.AirQuality.EXCELLENT]=900;// 700
						Serv.levelNum[Characteristic.AirQuality.GOOD]=1150;// 1100
						Serv.levelNum[Characteristic.AirQuality.FAIR]=1400;// 1600
						Serv.levelNum[Characteristic.AirQuality.INFERIOR]=1600;// 2100
						Serv.levelNum[Characteristic.AirQuality.POOR]=100000;
					} else {
						Serv.levelTxt=[];		
						Serv.levelTxt[Characteristic.AirQuality.EXCELLENT]="Excellent";
						Serv.levelTxt[Characteristic.AirQuality.GOOD]="Bon";
						Serv.levelTxt[Characteristic.AirQuality.FAIR]="Moyen";
						Serv.levelTxt[Characteristic.AirQuality.INFERIOR]="Inférieur";
						Serv.levelTxt[Characteristic.AirQuality.POOR]="Faible";
					}
					
					Serv.cmd_id = cmd.CO2.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = 'CO2';
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					const uniteCO2 = Serv.infos.CO2.unite ? Serv.infos.CO2.unite : '';
					if(uniteCO2) {
						const propsCO2 = {};
						propsCO2.unit=uniteCO2;
						Serv.getCharacteristic(Characteristic.CarbonDioxideLevel).setProps(propsCO2);
					}
					
					if(that.fakegato && !eqLogic.hasLogging) {
						HBservice.characteristics.push(Characteristic.PPM);
						Serv.addCharacteristic(Characteristic.PPM);
						const unite = Serv.infos.CO2.unite ? Serv.infos.CO2.unite : '';
						if(unite) {
							const props = {};
							props.unit=unite;
							Serv.getCharacteristic(Characteristic.PPM).setProps(props);
						}
						HBservice.characteristics.push(Characteristic.AQExtraCharacteristic);
						Serv.addCharacteristic(Characteristic.AQExtraCharacteristic);

						eqLogic.loggingService ={type:"room", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.AirQualityCustom) {
			eqLogic.services.AirQualityCustom.forEach(function(cmd) {
				if (cmd.Index) {
					HBservice = {
						controlService : new Service.AirQualitySensor(eqLogic.name),
						characteristics : [Characteristic.AirQuality],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.Index=cmd.Index;
					
					if(eqLogic.customizedValues && cmd.Index.subType=='numeric') {
						Serv.levelNum=[];	
						if(eqLogic.customizedValues.EXCELLENT && eqLogic.customizedValues.EXCELLENT != "NOT") {
							Serv.levelNum[Characteristic.AirQuality.EXCELLENT] = parseInt(eqLogic.customizedValues.EXCELLENT);
						} else {
							that.log('warn',"Pas de config de la valeur 'Excellent', on la défini sur 50");
							Serv.levelNum[Characteristic.AirQuality.EXCELLENT]=50;
						}
						if(eqLogic.customizedValues.GOOD && eqLogic.customizedValues.GOOD != "NOT") {
							Serv.levelNum[Characteristic.AirQuality.GOOD] = parseInt(eqLogic.customizedValues.GOOD);
						} else {
							that.log('warn',"Pas de config de la valeur 'Bon', on la défini sur 100");
							Serv.levelNum[Characteristic.AirQuality.GOOD]=100;
						}
						if(eqLogic.customizedValues.FAIR && eqLogic.customizedValues.FAIR != "NOT") {
							Serv.levelNum[Characteristic.AirQuality.FAIR] = parseInt(eqLogic.customizedValues.FAIR);
						} else {
							that.log('warn',"Pas de config de la valeur 'Moyen', on la défini sur 150");
							Serv.levelNum[Characteristic.AirQuality.FAIR]=150;
						}
						if(eqLogic.customizedValues.INFERIOR && eqLogic.customizedValues.INFERIOR != "NOT") {
							Serv.levelNum[Characteristic.AirQuality.INFERIOR] = parseInt(eqLogic.customizedValues.INFERIOR);
						} else {
							that.log('warn',"Pas de config de la valeur 'Inférieur', on la défini sur 200");
							Serv.levelNum[Characteristic.AirQuality.INFERIOR]=200;
						}
						if(eqLogic.customizedValues.POOR && eqLogic.customizedValues.POOR != "NOT") {
							Serv.levelNum[Characteristic.AirQuality.POOR] = parseInt(eqLogic.customizedValues.POOR);
						} else {
							that.log('warn',"Pas de config de la valeur 'Faible', on la défini sur 1000");
							Serv.levelNum[Characteristic.AirQuality.POOR]=1000;
						}
					} else if(that.myPlugin == "homebridge") {
						that.log('warn',"Pas de config numérique des valeurs que qualité d'air");
					}

					
					Serv.cmd_id = cmd.Index.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = 'AirQualityCustom';
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						HBservice.characteristics.push(Characteristic.VOCDensity);
						Serv.addCharacteristic(Characteristic.VOCDensity);
						const unite = Serv.infos.Index.unite ? Serv.infos.Index.unite : '';
						if(unite) {
							const props = {};
							props.unit=unite;
							if(Serv.levelNum) {props.maxValue=parseInt(Serv.levelNum[Characteristic.AirQuality.POOR]*4.57);}
							Serv.getCharacteristic(Characteristic.VOCDensity).setProps(props);
						}
						HBservice.characteristics.push(Characteristic.AQExtraCharacteristic);
						Serv.addCharacteristic(Characteristic.AQExtraCharacteristic);

						eqLogic.loggingService ={type:"room2", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}	
		if (eqLogic.services.AirQuality) {
			eqLogic.services.AirQuality.forEach(function(cmd) {
				if (cmd.Index) {
					HBservice = {
						controlService : new Service.AirQualitySensor(eqLogic.name),
						characteristics : [Characteristic.AirQuality],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.Index=cmd.Index;
					eqServicesCopy.AirQuality.forEach(function(cmd2) {
						if (cmd2.PM25) {
							Serv.infos.PM25= cmd2.PM25;
						}
					});	
					// if there is a PM2.5 density, display it
					if(Serv.infos.PM25) {
						HBservice.characteristics.push(Characteristic.PM2_5Density);
						Serv.addCharacteristic(Characteristic.PM2_5Density);
					}
					// AQI Generic
					HBservice.characteristics.push(Characteristic.AQI);
					Serv.addCharacteristic(Characteristic.AQI);
					Serv.getCharacteristic(Characteristic.AQI).displayName = cmd.Index.name;
					
					if(cmd.Index.subType=='numeric') {
						Serv.levelNum=[];		
						Serv.levelNum[Characteristic.AirQuality.EXCELLENT]=50;
						Serv.levelNum[Characteristic.AirQuality.GOOD]=100;
						Serv.levelNum[Characteristic.AirQuality.FAIR]=150;
						Serv.levelNum[Characteristic.AirQuality.INFERIOR]=200;
						Serv.levelNum[Characteristic.AirQuality.POOR]=1000;
					} else {
						Serv.levelTxt=[];		
						Serv.levelTxt[Characteristic.AirQuality.EXCELLENT]="Excellent";
						Serv.levelTxt[Characteristic.AirQuality.GOOD]="Bon";
						Serv.levelTxt[Characteristic.AirQuality.FAIR]="Moyen";
						Serv.levelTxt[Characteristic.AirQuality.INFERIOR]="Inférieur";
						Serv.levelTxt[Characteristic.AirQuality.POOR]="Faible";
					}
					Serv.cmd_id = cmd.Index.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = 'AQI';
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		} 	
		if (eqLogic.services.presence) {
			eqLogic.services.presence.forEach(function(cmd) {
				if (cmd.presence) {
					let SensorName=eqLogic.name;
					if(eqLogic.numDetector>1) {
						that.log('debug',"Detecteurs multiples dans même équipement, il y en a "+eqLogic.numDetector);
						SensorName=cmd.presence.name;
					}
					HBservice = {
						controlService : new Service.MotionSensor(SensorName),
						characteristics : [Characteristic.MotionDetected],
					};
					const Serv = HBservice.controlService;
					if(eqLogic.numDetector>1) {
						that.log('debug',"Nom du détecteur (multi) : "+SensorName);
						Serv.getCharacteristic(Characteristic.MotionDetected).displayName = SensorName;
						
						Serv.ConfiguredName=SensorName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SensorName);
					}
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.presence=cmd.presence;
					Serv.invertBinary=0;
					if(cmd.presence.display && cmd.presence.display.invertBinary != undefined) {
						Serv.invertBinary=cmd.presence.display.invertBinary;
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);

					Serv.cmd_id = cmd.presence.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						HBservice.characteristics.push(Characteristic.Sensitivity,Characteristic.Duration,Characteristic.LastActivation);
						Serv.addOptionalCharacteristic(Characteristic.Sensitivity);
						Serv.addOptionalCharacteristic(Characteristic.Duration);
						Serv.addOptionalCharacteristic(Characteristic.LastActivation);

						// eqLogic.loggingService = {type:"motion", options:{storage:'googleDrive',folder:'fakegato',keyPath:'/home/pi/.homebridge/'},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.loggingService = {type:"motion", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};

						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.occupancy) {
			eqLogic.services.occupancy.forEach(function(cmd) {
				if (cmd.occupancy) {
					let SensorName=eqLogic.name;
					if(eqLogic.numDetector>1) {
						that.log('debug',"Detecteurs occupancy multiples dans même équipement, il y en a "+eqLogic.numDetector);
						SensorName=cmd.occupancy.name;
					}
					HBservice = {
						controlService : new Service.OccupancySensor(SensorName),
						characteristics : [Characteristic.OccupancyDetected],
					};
					const Serv = HBservice.controlService;
					if(eqLogic.numDetector>1) {
						that.log('debug',"Nom du détecteur (multi) : "+SensorName);
						Serv.getCharacteristic(Characteristic.OccupancyDetected).displayName = SensorName;
						
						Serv.ConfiguredName=SensorName;
						HBservice.characteristics.push(Characteristic.ConfiguredName);
						Serv.addCharacteristic(Characteristic.ConfiguredName);
						Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(SensorName);
					}
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.occupancy=cmd.occupancy;
					Serv.invertBinary=0;
					if(cmd.occupancy.display && cmd.occupancy.display.invertBinary != undefined) {
						Serv.invertBinary=cmd.occupancy.display.invertBinary;
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);

					Serv.cmd_id = cmd.occupancy.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}		
		if (eqLogic.services.generic) {
			eqLogic.services.generic.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.CustomService(cmd.state.name),
						characteristics : [],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					var props = {};
					var unite = '';
					if(cmd.state.subType=="numeric") {
						that.log('debug','Le générique',cmd.state.name,'est un numérique');
						// test if default value is Float or Int ?
						var CharactToSet=Characteristic.GenericFLOAT;
						var NumericGenericType='float';
						if(cmd.state.currentValue.toString().indexOf('.') == -1) {
							CharactToSet=Characteristic.GenericINT;
							NumericGenericType='int';
						}
						that.log('debug','Sur base de sa valeur actuelle',cmd.state.currentValue,', on determine un type :',NumericGenericType);
						HBservice.characteristics.push(CharactToSet);
						Serv.addCharacteristic(CharactToSet);
						Serv.getCharacteristic(CharactToSet).displayName = cmd.state.name;
						
						unite = cmd.state.unite ? cmd.state.unite : '';
						if(unite) {props.unit=unite;}
						if(cmd.state.configuration) {
							if(NumericGenericType=='float'){
								if(cmd.state.configuration.maxValue != null && cmd.state.configuration.maxValue != undefined && cmd.state.configuration.maxValue != "") {props.maxValue = parseFloat(cmd.state.configuration.maxValue);}
								if(cmd.state.configuration.minValue != null && cmd.state.configuration.minValue != undefined && cmd.state.configuration.minValue != "") {props.minValue = parseFloat(cmd.state.configuration.minValue);}
							} else if (NumericGenericType=='int'){
								if(cmd.state.configuration.maxValue != null && cmd.state.configuration.maxValue != undefined && cmd.state.configuration.maxValue != "") {props.maxValue = parseInt(cmd.state.configuration.maxValue);}
								if(cmd.state.configuration.minValue != null && cmd.state.configuration.minValue != undefined && cmd.state.configuration.minValue != "") {props.minValue = parseInt(cmd.state.configuration.minValue);}
							}
						}
						if(Object.keys(props).length !== 0) {
							that.log('debug','On lui set les props suivants :',props);
							Serv.getCharacteristic(CharactToSet).setProps(props);
						}
					} else if (cmd.state.subType=="binary") {
						that.log('debug','Le générique',cmd.state.name,'est un booléen');
						HBservice.characteristics.push(Characteristic.GenericBOOL);
						Serv.addCharacteristic(Characteristic.GenericBOOL);
						Serv.getCharacteristic(Characteristic.GenericBOOL).displayName = cmd.state.name;
					} else if (cmd.state.subType=="string" || cmd.state.subType=="other") {
						that.log('debug','Le générique',cmd.state.name,'est une chaîne');
						HBservice.characteristics.push(Characteristic.GenericSTRING);
						Serv.addCharacteristic(Characteristic.GenericSTRING);
						Serv.getCharacteristic(Characteristic.GenericSTRING).displayName = cmd.state.name;
						
						unite = cmd.state.unite ? cmd.state.unite : '';
						if(unite) {props.unit=unite;}
						if(Object.keys(props).length !== 0) {
							that.log('debug','On lui set les props suivants :',props);
							Serv.getCharacteristic(Characteristic.GenericSTRING).setProps(props);
						}
					}					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id +'-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.uv) {
			eqLogic.services.uv.forEach(function(cmd) {
				if (cmd.uv) {
					HBservice = {
						controlService : new Service.WeatherService(eqLogic.name),
						characteristics : [Characteristic.UVIndex],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.uv=cmd.uv;
					Serv.cmd_id = cmd.uv.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}		
		if (eqLogic.services.speaker) {
			eqLogic.services.speaker.forEach(function(cmd) {
				if (cmd.volume) {
					HBservice = {
						controlService : new Service.Speaker(eqLogic.name),
						characteristics : [Characteristic.Mute,Characteristic.Volume],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.volume=cmd.volume;
					eqServicesCopy.speaker.forEach(function(cmd2) {
						if (cmd2.mute_toggle) {
							Serv.actions.mute_toggle = cmd2.mute_toggle;
						} else if (cmd2.mute_on) {
							Serv.actions.mute_on = cmd2.mute_on;
						} else if (cmd2.mute_off) {
							Serv.actions.mute_off = cmd2.mute_off;
						} else if (cmd2.set_volume) {
							Serv.actions.set_volume = cmd2.set_volume;
						} else if (cmd2.mute) {
							Serv.infos.mute=cmd2.mute;
						}
					});
					if(!Serv.actions.set_volume) {that.log('warn','Pas de type générique "Action/Haut-Parleur Volume"');}
					if(!Serv.actions.mute_toggle && !Serv.actions.mute_on && Serv.actions.mute_off) {that.log('warn','Pas de type générique "Action/Haut-Parleur Mute"');}
					if(!Serv.actions.mute_toggle && Serv.actions.mute_on && !Serv.actions.mute_off) {that.log('warn','Pas de type générique "Action/Haut-Parleur UnMute"');}
					if(!Serv.actions.mute_toggle && !Serv.actions.mute_on && !Serv.actions.mute_off) {that.log('warn','Pas de type générique "Action/Haut-Parleur Toggle Mute" / "Action/Haut-Parleur Mute" / "Action/Haut-Parleur UnMute"');}
					Serv.cmd_id = cmd.volume.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Haut-Parleur Volume"');
			} else {
				HBservice = null;
			}
		}			
		if (eqLogic.services.temperature) {
			eqLogic.services.temperature.forEach(function(cmd) {
				if (cmd.temperature) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.temperature=cmd.temperature;
					
					HBservice.characteristics.push(Characteristic.TemperatureDisplayUnits);
					Serv.addOptionalCharacteristic(Characteristic.TemperatureDisplayUnits);
					Serv.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.temperature.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService ={type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
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
						characteristics : [Characteristic.CurrentRelativeHumidity],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.humidity=cmd.humidity;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.humidity.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService = {type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.pressure) {
			eqLogic.services.pressure.forEach(function(cmd) {
				if (cmd.pressure) {
					HBservice = {
						controlService : new Service.PressureSensor(eqLogic.name),
						characteristics : [Characteristic.AirPressure],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.pressure=cmd.pressure;
					Serv.cmd_id = cmd.pressure.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService = {type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
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
						characteristics : [Characteristic.SmokeDetected],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.smoke=cmd.smoke;
					Serv.invertBinary=0;
					if(cmd.smoke.display && cmd.smoke.display.invertBinary != undefined) {
						Serv.invertBinary=cmd.smoke.display.invertBinary;
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.smoke.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
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
						characteristics : [Characteristic.LeakDetected],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.flood=cmd.flood;
					Serv.invertBinary=0;
					if(cmd.flood.display && cmd.flood.display.invertBinary != undefined) {
						Serv.invertBinary=cmd.flood.display.invertBinary;
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.flood.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
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
						characteristics : [Characteristic.ContactSensorState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.opening=cmd.opening;
					Serv.invertBinary=0;
					if(cmd.opening.display && cmd.opening.display.invertBinary != undefined) {
						Serv.invertBinary=cmd.opening.display.invertBinary;
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.opening.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						// Serv.eqLogic.numberOpened = 0;
						HBservice.characteristics.push(Characteristic.TimesOpened,Characteristic.Char118,Characteristic.Char119,Characteristic.ResetTotal,Characteristic.LastActivation);
						Serv.addOptionalCharacteristic(Characteristic.TimesOpened);
						Serv.addOptionalCharacteristic(Characteristic.Char118);
						Serv.addOptionalCharacteristic(Characteristic.Char119);
						Serv.addOptionalCharacteristic(Characteristic.ResetTotal);
						Serv.addOptionalCharacteristic(Characteristic.LastActivation);

						eqLogic.loggingService = {type:"door", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
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
						characteristics : [Characteristic.CurrentAmbientLightLevel],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.brightness=cmd.brightness;
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.brightness.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					/* if(that.fakegato && !eqLogic.hasLogging) {
						// HBservice.characteristics.push(Characteristic.Sensitivity,Characteristic.Duration,Characteristic.LastActivation);

						// eqLogic.loggingService = {type:"motion", options:{storage:'googleDrive',folder:'fakegato',keyPath:'/home/pi/.homebridge/'},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.loggingService = {type:"custom", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};

						eqLogic.hasLogging=true;
					} */
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.GarageDoor) {
			eqLogic.services.GarageDoor.forEach(function(cmd) {
				if (cmd.state) {
					HBservice = {
						controlService : new Service.GarageDoorOpener(eqLogic.name),
						characteristics : [Characteristic.CurrentDoorState, Characteristic.TargetDoorState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.GarageDoor.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						} else if (cmd2.toggle) {
							Serv.actions.toggle = cmd2.toggle;
						}
					});
					if(!Serv.actions.toggle && !Serv.actions.on && Serv.actions.off) {that.log('warn','Pas de type générique "Action/Portail ou garage bouton d\'ouverture"');}
					if(!Serv.actions.toggle && Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique "Action/Portail ou garage bouton de fermeture"');}
					if(!Serv.actions.toggle && !Serv.actions.on && !Serv.actions.off) {that.log('warn','Pas de type générique ""Action/Portail ou garage bouton toggle" / "Action/Portail ou garage bouton d\'ouverture" / "Action/Portail ou garage bouton de fermeture"');}
									
					if(eqLogic.customizedValues) {
						Serv.customizedValues = eqLogic.customizedValues;
					}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
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
					HBservice = {
						controlService : new Service.LockMechanism(eqLogic.name),
						characteristics : [Characteristic.LockCurrentState, Characteristic.LockTargetState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					eqServicesCopy.lock.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on = cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off = cmd2.off;
						}
					});
					if(!Serv.actions.on) {that.log('warn','Pas de type générique "Action/Serrure Bouton Ouvrir"');}
					// if(!Serv.actions.off) {that.log('warn','Pas de type générique "Action/Serrure Bouton Fermer"');}
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
				}
			});
			if(!HBservice) {
				that.log('warn','Pas de type générique "Info/Serrure Etat"');
			} else {
				HBservice = null;
			}
		}
		if (eqLogic.services.StatelessSwitch) {
			eqLogic.services.StatelessSwitch.forEach(function(cmd) {
				if(cmd.eventType) {
					let buttonSingle,buttonDouble,buttonLong;
					
					if(cmd.eventType.customizedValues.SINGLE) {
						buttonSingle = cmd.eventType.customizedValues.SINGLE.split(';');
					} else {
						buttonSingle = [""];
					}
					if(cmd.eventType.customizedValues.DOUBLE) {
						buttonDouble = cmd.eventType.customizedValues.DOUBLE.split(';');
					} else {
						buttonDouble = [""];
					}
					if(cmd.eventType.customizedValues.LONG) {
						buttonLong = cmd.eventType.customizedValues.LONG.split(';');
					} else {
						buttonLong = [""];
					}
					const maxValues = Math.max(buttonSingle.length,buttonDouble.length,buttonLong.length);
					
					if(buttonSingle.length === buttonDouble.length && buttonDouble.length === buttonLong.length) {
					
						for(let b = 0;b<maxValues;b++) {
							const numButton = b+1;
							HBservice = {
								controlService : new Service.StatelessProgrammableSwitch(eqLogic.name+' '+numButton),
								characteristics : [Characteristic.ProgrammableSwitchEvent, Characteristic.ServiceLabelIndex],
							};
							const Serv = HBservice.controlService;
							Serv.eqLogic=eqLogic;
							eqLogic.indexStateless = ++eqLogic.indexStateless || 1;
							Serv.ServiceLabelIndex = numButton;
							Serv.type='Multi';
							
							Serv.customizedValues = cmd.eventType.customizedValues;
							const values = [];
							if(buttonSingle[b].trim() != '') {values.push(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);}
							if(buttonDouble[b].trim() != '') {values.push(Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);}
							if(buttonLong[b].trim() != '') {values.push(Characteristic.ProgrammableSwitchEvent.LONG_PRESS);}
							that.log('debug','ValidValues',values);
							Serv.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setProps({validValues:values});
							
							Serv.getCharacteristic(Characteristic.ServiceLabelIndex).updateValue(Serv.ServiceLabelIndex);
							Serv.actions={};
							Serv.infos={};
							Serv.infos.eventType=cmd.eventType;
							Serv.cmd_id = cmd.eventType.id;
							Serv.eqID = eqLogic.id;
							Serv.subtype = Serv.subtype || '';
							Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype+numButton;
							
							if(!eqLogic.LabelExists) {
								const tmpHBservice = {
									controlService : new Service.ServiceLabel(eqLogic.name, eqLogic.id+'_label'),
									characteristics : [Characteristic.ServiceLabelNamespace],
								};
								const Namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS;
								// let Namespace = Characteristic.ServiceLabelNamespace.DOTS;
								tmpHBservice.controlService.getCharacteristic(Characteristic.ServiceLabelNamespace).updateValue(Namespace);
								tmpHBservice.controlService.cmd_id = eqLogic.id+'_label';
								eqLogic.LabelExists = tmpHBservice.controlService;
								HBservices.push(tmpHBservice);
							}
							
							HBservices.push(HBservice);
							HBservice = null;
						}
						
					} else {
						that.log('warn',"Pas le même nombre de boutons pour chaque évènement (il doit y avoir le même nombre de ';')");
					}
				}
			});
		}		
		if (eqLogic.services.StatelessSwitchMono) {
			const buttonList=[];
			eqLogic.services.StatelessSwitchMono.forEach(function(cmd) {
				if(cmd.Single || cmd.Double || cmd.Long) {
					let Label = "";
					if(cmd.Single) {Label = "Simple";}
					if(cmd.Double) {Label = "Double";}
					if(cmd.Long) {Label = "Long";}
					
					const cmdType = cmd.Single || cmd.Double || cmd.Long;
					if(buttonList[cmdType.customizedValues.BUTTON] === undefined) {buttonList[cmdType.customizedValues.BUTTON] = [];}
					buttonList[cmdType.customizedValues.BUTTON][Label] = cmdType;
				}		
			});	

			if(buttonList.length) {
				for(const b in buttonList) {
					if (buttonList.hasOwnProperty(b)) {
						const cmdType = buttonList[b];
						if(parseInt(b) === 0) { // one button by event
							for(const e in cmdType) {
								if (cmdType.hasOwnProperty(e)) {
									HBservice = {
										controlService : new Service.StatelessProgrammableSwitch(eqLogic.name+' '+cmdType[e].name+' '+e+' Click'),
										characteristics : [Characteristic.ProgrammableSwitchEvent, Characteristic.ServiceLabelIndex],
									};
									const Serv = HBservice.controlService;
									Serv.eqLogic=eqLogic;
									eqLogic.indexStateless = ++eqLogic.indexStateless || 1;
									Serv.ServiceLabelIndex = 20+eqLogic.indexStateless;
									Serv.type = 'Mono';
									Serv.actions={};
									Serv.infos={};
									Serv.cmd_id ='';
									
									const values = [];
									switch(e) {
										case 'Simple':
											values.push(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
											Serv.infos.Single=cmdType[e];
											Serv.cmd_id += Serv.infos.Single.id;
										break;
										case 'Double':
											values.push(Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);
											Serv.infos.Double=cmdType[e];
											Serv.cmd_id += Serv.infos.Double.id;
										break;
										case 'Long':
											values.push(Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
											Serv.infos.Long=cmdType[e];
											Serv.cmd_id += Serv.infos.Long.id;
										break;
									}
									that.log('debug','ValidValues 0 Mono',values);
									Serv.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setProps({validValues:values});

									
									Serv.getCharacteristic(Characteristic.ServiceLabelIndex).updateValue(Serv.ServiceLabelIndex);

									Serv.eqID = eqLogic.id;
									Serv.subtype = Serv.subtype || '';
									Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
									
									if(!eqLogic.LabelService) {
										const tmpHBservice = {
											controlService : new Service.ServiceLabel(eqLogic.name, eqLogic.id+'_label'),
											characteristics : [Characteristic.ServiceLabelNamespace],
										};
										const Namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS;
										// let Namespace = Characteristic.ServiceLabelNamespace.DOTS;
										tmpHBservice.controlService.getCharacteristic(Characteristic.ServiceLabelNamespace).updateValue(Namespace);
										tmpHBservice.controlService.cmd_id = eqLogic.id+'_label';
										eqLogic.LabelService = tmpHBservice.controlService;
										HBservices.push(tmpHBservice);
									}
									
									HBservices.push(HBservice);
									HBservice = null;
								}
							}
						} else { // groupped buttons
							HBservice = {
								controlService : new Service.StatelessProgrammableSwitch(eqLogic.name+' '+b),
								characteristics : [Characteristic.ProgrammableSwitchEvent, Characteristic.ServiceLabelIndex],
							};
							const Serv = HBservice.controlService;
							Serv.eqLogic=eqLogic;
							Serv.ServiceLabelIndex = b;
							Serv.type = 'Mono';
							Serv.actions={};
							Serv.infos={};
							Serv.cmd_id ='';
							
							const values = [];
							if(cmdType.Simple !== undefined) {
								values.push(Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS);
								Serv.infos.Single=cmdType.Simple;
								Serv.cmd_id += Serv.infos.Single.id;
							}
							if(cmdType.Double !== undefined) {
								values.push(Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS);
								Serv.infos.Double=cmdType.Double;
								Serv.cmd_id += Serv.infos.Double.id;
							}
							if(cmdType.Long !== undefined) {
								values.push(Characteristic.ProgrammableSwitchEvent.LONG_PRESS);
								Serv.infos.Long=cmdType.Long;
								Serv.cmd_id += Serv.infos.Long.id;
							}
							that.log('debug','ValidValues '+b+' Mono',values);
							Serv.getCharacteristic(Characteristic.ProgrammableSwitchEvent).setProps({validValues:values});

							
							Serv.getCharacteristic(Characteristic.ServiceLabelIndex).updateValue(Serv.ServiceLabelIndex);

							Serv.eqID = eqLogic.id;
							Serv.subtype = Serv.subtype || '';
							Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
							
							if(!eqLogic.LabelService) {
								const tmpHBservice = {
									controlService : new Service.ServiceLabel(eqLogic.name, eqLogic.id+'_label'),
									characteristics : [Characteristic.ServiceLabelNamespace],
								};
								const Namespace = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS;
								// let Namespace = Characteristic.ServiceLabelNamespace.DOTS;
								tmpHBservice.controlService.getCharacteristic(Characteristic.ServiceLabelNamespace).updateValue(Namespace);
								tmpHBservice.controlService.cmd_id = eqLogic.id+'_label';
								eqLogic.LabelService = tmpHBservice.controlService;
								HBservices.push(tmpHBservice);
							}
							
							HBservices.push(HBservice);
							HBservice = null;
							
							
							
						}
					}
				}
			}	
			
		}	
		if (eqLogic.services.weather) {
			eqLogic.services.weather.forEach(function(cmd) {
				if(cmd.temperature) {
					HBservice = {
						controlService : new Service.TemperatureSensor(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.temperature=cmd.temperature;
					Serv.isPrimaryService = true;

					HBservice.characteristics.push(Characteristic.TemperatureDisplayUnits);
					Serv.addOptionalCharacteristic(Characteristic.TemperatureDisplayUnits);
					Serv.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);

					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);	

					Serv.cmd_id = cmd.temperature.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.cmd_id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService ={type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}		
				if(cmd.humidity) {
					HBservice = {
						controlService : new Service.HumiditySensor(eqLogic.name),
						characteristics : [Characteristic.CurrentRelativeHumidity],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.humidity=cmd.humidity;

					Serv.cmd_id = cmd.humidity.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.cmd_id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService ={type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}		
				if(cmd.pressure) {
					HBservice = {
						controlService : new Service.PressureSensor(eqLogic.name),
						characteristics : [Characteristic.AirPressure],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.pressure=cmd.pressure;

					Serv.cmd_id = cmd.pressure.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.cmd_id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService ={type:"weather", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					
					HBservices.push(HBservice);
					HBservice = null;
				}				
				if(cmd.condition) {
					HBservice = {
						controlService : new Service.WeatherService(eqLogic.name),
						characteristics : [Characteristic.WeatherCondition],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.condition=cmd.condition;

					eqServicesCopy.weather.forEach(function(cmd2) {
						if (cmd2.wind_speed) {
							Serv.infos.wind_speed=cmd2.wind_speed;
							HBservice.characteristics.push(Characteristic.WindSpeed);
							Serv.addCharacteristic(Characteristic.WindSpeed);
							Serv.getCharacteristic(Characteristic.WindSpeed).displayName = cmd2.wind_speed.name;
							
							const unite = Serv.infos.wind_speed.unite ? Serv.infos.wind_speed.unite : '';
							if(unite) {
								const props = {};
								props.unit=unite;
								Serv.getCharacteristic(Characteristic.WindSpeed).setProps(props);
							}
						} else if (cmd2.wind_direction) {
							Serv.infos.wind_direction=cmd2.wind_direction;
							HBservice.characteristics.push(Characteristic.WindDirection);
							Serv.addCharacteristic(Characteristic.WindDirection);
							Serv.getCharacteristic(Characteristic.WindDirection).displayName = cmd2.wind_direction.name;
						} else if (cmd2.UVIndex) {
							Serv.infos.UVIndex=cmd2.UVIndex;
							HBservice.characteristics.push(Characteristic.UVIndex);
							Serv.addCharacteristic(Characteristic.UVIndex);
							Serv.getCharacteristic(Characteristic.UVIndex).displayName = cmd2.UVIndex.name;
						} else if (cmd2.visibility) {
							Serv.infos.visibility=cmd2.visibility;
							HBservice.characteristics.push(Characteristic.Visibility);
							Serv.addCharacteristic(Characteristic.Visibility);
							Serv.getCharacteristic(Characteristic.Visibility).displayName = cmd2.visibility.name;
							
							const unite = Serv.infos.wind_speed.unite ? Serv.infos.wind_speed.unite : '';
							if(unite) {
								const props = {};
								props.unit=unite;
								Serv.getCharacteristic(Characteristic.Visibility).setProps(props);
							}
						} else if (cmd2.rain) {
							Serv.infos.rain=cmd2.rain;
							HBservice.characteristics.push(Characteristic.Rain);
							Serv.addCharacteristic(Characteristic.Rain);
							Serv.getCharacteristic(Characteristic.Rain).displayName = cmd2.rain.name;
						} else if (cmd2.snow) {
							Serv.infos.snow=cmd2.snow;
							HBservice.characteristics.push(Characteristic.Snow);
							Serv.addCharacteristic(Characteristic.Snow);
							Serv.getCharacteristic(Characteristic.Snow).displayName = cmd2.snow.name;
						} else if (cmd2.temperature_min) {
							Serv.infos.temperature_min=cmd2.temperature_min;
							HBservice.characteristics.push(Characteristic.MinimumTemperature);
							Serv.addCharacteristic(Characteristic.MinimumTemperature);
							Serv.getCharacteristic(Characteristic.MinimumTemperature).displayName = cmd2.temperature_min.name;
						}
					});

					Serv.cmd_id = cmd.condition.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.cmd_id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}		
		if (eqLogic.services.thermostat) {
			eqLogic.services.thermostat.forEach(function(cmd) {
				if(cmd.setpoint) {
					HBservice = {
						controlService : new Service.Thermostat(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature, Characteristic.TargetTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.setpoint=cmd.setpoint;
					Serv.thermo={};
					
					HBservice.characteristics.push(Characteristic.TemperatureDisplayUnits);
					Serv.addOptionalCharacteristic(Characteristic.TemperatureDisplayUnits);
					Serv.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);
					
					eqServicesCopy.thermostat.forEach(function(cmd2) {
						if (cmd2.state_name) {
							Serv.infos.state_name=cmd2.state_name;
						} else if (cmd2.lock) {
							Serv.infos.lock=cmd2.lock;
							HBservice.characteristics.push(Characteristic.LockPhysicalControls);
							Serv.addCharacteristic(Characteristic.LockPhysicalControls);
							Serv.getCharacteristic(Characteristic.LockPhysicalControls).displayName = cmd2.lock.name;
						} else if (cmd2.mode) {
							Serv.infos.mode=cmd2.mode;
						} else if (cmd2.temperature) {
							Serv.infos.temperature=cmd2.temperature;
						} else if (cmd2.state) {
							Serv.infos.state=cmd2.state;
						} else if (cmd2.set_lock) {
							Serv.actions.set_lock=cmd2.set_lock;
						} else if (cmd2.set_unlock) {
							Serv.actions.set_unlock=cmd2.set_unlock;
						} else if (cmd2.set_setpoint) {
							Serv.actions.set_setpoint=cmd2.set_setpoint;
						}
					});

					var props = {};
					if(Serv.actions.set_setpoint && Serv.actions.set_setpoint.configuration && Serv.actions.set_setpoint.configuration.minValue && parseInt(Serv.actions.set_setpoint.configuration.minValue)) {
						props.minValue = parseInt(Serv.actions.set_setpoint.configuration.minValue);
					}
					if(Serv.actions.set_setpoint && Serv.actions.set_setpoint.configuration && Serv.actions.set_setpoint.configuration.maxValue && parseInt(Serv.actions.set_setpoint.configuration.maxValue)) {
						props.maxValue = parseInt(Serv.actions.set_setpoint.configuration.maxValue);
					}
					if(props.minValue && props.maxValue) {
						Serv.getCharacteristic(Characteristic.TargetTemperature).setProps(props);	
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);	

					props = {};
					props.validValues=[0];
					if(eqLogic.thermoModes) {
						if(eqLogic.thermoModes.Chauf && eqLogic.thermoModes.Chauf != "NOT") {
							Serv.thermo.chauf = {};
							const splitted = eqLogic.thermoModes.Chauf.split('|');
							Serv.thermo.chauf.mode_label = splitted[1];
							Serv.thermo.chauf.mode_id = splitted[0];
							props.validValues.push(1);
						} else {
							that.log('warn','Pas de config du mode Chauffage');
						}
						if(eqLogic.thermoModes.Clim && eqLogic.thermoModes.Clim != "NOT") {
							Serv.thermo.clim = {};
							const splitted = eqLogic.thermoModes.Clim.split('|');
							Serv.thermo.clim.mode_label = splitted[1];
							Serv.thermo.clim.mode_id = splitted[0];
							props.validValues.push(2);
						} else {
							that.log('warn','Pas de config du mode Climatisation');
						}
						if(eqLogic.thermoModes.Off && eqLogic.thermoModes.Off != "NOT") {
							Serv.thermo.off = {};
							const splitted = eqLogic.thermoModes.Off.split('|');
							Serv.thermo.off.mode_label = splitted[1];
							Serv.thermo.off.mode_id = splitted[0];
						}
					} else if(that.myPlugin == "homebridge") {
						that.log('warn','Pas de config des modes du thermostat');
					}
					// Serv.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setProps(props);
					props.validValues.push(3);
					Serv.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps(props);
					Serv.cmd_id = cmd.setpoint.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					if(that.fakegato && !eqLogic.hasLogging) {
						eqLogic.loggingService ={type:"thermo", options:{storage:'fs',path:that.pathHomebridgeConf},subtype:Serv.eqID+'-history',cmd_id:Serv.eqID};
						eqLogic.hasLogging=true;
					}
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.thermostatHC) {
			eqLogic.services.thermostatHC.forEach(function(cmd) {
				if(cmd.setpointH) {
					HBservice = {
						controlService : new Service.HeaterCooler(eqLogic.name),
						characteristics : [Characteristic.CurrentTemperature, Characteristic.CoolingThresholdTemperature, Characteristic.HeatingThresholdTemperature, Characteristic.CurrentHeatingCoolingState, Characteristic.TargetHeatingCoolingState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.setpointH=cmd.setpointH;
					Serv.thermoHC={};
					
					HBservice.characteristics.push(Characteristic.TemperatureDisplayUnits);
					Serv.addOptionalCharacteristic(Characteristic.TemperatureDisplayUnits);
					Serv.getCharacteristic(Characteristic.TemperatureDisplayUnits).updateValue(Characteristic.TemperatureDisplayUnits.CELSIUS);
					
					eqServicesCopy.thermostatHC.forEach(function(cmd2) {
						if (cmd2.setpointC) {
							Serv.infos.setpointC=cmd2.setpointC;
						} else if (cmd2.state_name) {
							Serv.infos.state_name=cmd2.state_name;
						} else if (cmd2.lock) {
							Serv.infos.lock=cmd2.lock;
							HBservice.characteristics.push(Characteristic.LockPhysicalControls);
							Serv.addCharacteristic(Characteristic.LockPhysicalControls);
							Serv.getCharacteristic(Characteristic.LockPhysicalControls).displayName = cmd2.lock.name;
						} else if (cmd2.mode) {
							Serv.infos.mode=cmd2.mode;
						} else if (cmd2.temperature) {
							Serv.infos.temperature=cmd2.temperature;
						} else if (cmd2.state) {
							Serv.infos.state=cmd2.state;
						} else if (cmd2.set_lock) {
							Serv.actions.set_lock=cmd2.set_lock;
						} else if (cmd2.set_unlock) {
							Serv.actions.set_unlock=cmd2.set_unlock;
						} else if (cmd2.set_setpointH) {
							Serv.actions.set_setpointH=cmd2.set_setpointH;
						} else if (cmd2.set_setpointC) {
							Serv.actions.set_setpointC=cmd2.set_setpointC;
						}
					});

					var props = {};
					if(Serv.actions.set_setpointH && Serv.actions.set_setpointH.configuration && Serv.actions.set_setpointH.configuration.minValue && parseInt(Serv.actions.set_setpointH.configuration.minValue)) {
						props.minValue = parseInt(Serv.actions.set_setpointH.configuration.minValue);
					}
					if(Serv.actions.set_setpointH && Serv.actions.set_setpointH.configuration && Serv.actions.set_setpointH.configuration.maxValue && parseInt(Serv.actions.set_setpointH.configuration.maxValue)) {
						props.maxValue = parseInt(Serv.actions.set_setpointH.configuration.maxValue);
					}
					if(props.minValue && props.maxValue) {
						Serv.getCharacteristic(Characteristic.HeatingThresholdTemperature).setProps(props);	
					}
					props = {};
					if(Serv.actions.set_setpointC && Serv.actions.set_setpointC.configuration && Serv.actions.set_setpointC.configuration.minValue && parseInt(Serv.actions.set_setpointC.configuration.minValue)) {
						props.minValue = parseInt(Serv.actions.set_setpointC.configuration.minValue);
					}
					if(Serv.actions.set_setpointC && Serv.actions.set_setpointC.configuration && Serv.actions.set_setpointC.configuration.maxValue && parseInt(Serv.actions.set_setpointC.configuration.maxValue)) {
						props.maxValue = parseInt(Serv.actions.set_setpointC.configuration.maxValue);
					}
					if(props.minValue && props.maxValue) {
						Serv.getCharacteristic(Characteristic.CoolingThresholdTemperature).setProps(props);	
					}
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);	

					props = {};
					props.validValues=[0];
					if(eqLogic.thermoModes) {
						if(eqLogic.thermoModes.Chauf && eqLogic.thermoModes.Chauf != "NOT") {
							Serv.thermoHC.chauf = {};
							const splitted = eqLogic.thermoModes.Chauf.split('|');
							Serv.thermoHC.chauf.mode_label = splitted[1];
							Serv.thermoHC.chauf.mode_id = splitted[0];
							props.validValues.push(1);
						} else {
							that.log('warn','Pas de config du mode Chauffage');
						}
						if(eqLogic.thermoModes.Clim && eqLogic.thermoModes.Clim != "NOT") {
							Serv.thermoHC.clim = {};
							const splitted = eqLogic.thermoModes.Clim.split('|');
							Serv.thermoHC.clim.mode_label = splitted[1];
							Serv.thermoHC.clim.mode_id = splitted[0];
							props.validValues.push(2);
						} else {
							that.log('warn','Pas de config du mode Climatisation');
						}
						if(eqLogic.thermoModes.Off && eqLogic.thermoModes.Off != "NOT") {
							Serv.thermoHC.off = {};
							const splitted = eqLogic.thermoModes.Off.split('|');
							Serv.thermoHC.off.mode_label = splitted[1];
							Serv.thermoHC.off.mode_id = splitted[0];
						}
					}
					else if(that.myPlugin == "homebridge") {
							that.log('warn','Pas de config des modes du thermostatHC');
					}
					// Serv.getCharacteristic(Characteristic.CurrentHeatingCoolingState).setProps(props);
					props.validValues.push(3);
					Serv.getCharacteristic(Characteristic.TargetHeatingCoolingState).setProps(props);
					Serv.cmd_id = cmd.setpointH.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.mode) {
			let modeState=null;
			eqLogic.services.mode.forEach(function(cmd) {
				if(cmd.state) {
					HBservice = {
						controlService : new Service.CustomService(eqLogic.name),
						characteristics : [Characteristic.GenericSTRING],
					};
					const Serv = HBservice.controlService;
					
					Serv.addCharacteristic(Characteristic.GenericSTRING);
					Serv.getCharacteristic(Characteristic.GenericSTRING).displayName = cmd.state.name;
					
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					modeState=cmd.state;
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				} 
			});
			if(modeState) {
				var set_state_previous = null;
				eqLogic.services.mode.forEach(function(cmd) {
					if (cmd.set_state) {
						cmd.set_state.forEach(function(set_action) {
							var ModeName = "";
							if(set_action.name.toLowerCase().includes('mode') || set_action.name.toLowerCase().includes('modo')) {
								ModeName = set_action.name;
							} else {
								ModeName = "Mode "+set_action.name;
							}
							HBservice = {
								controlService : new Service.Switch(ModeName),
								characteristics : [Characteristic.On,Characteristic.ConfiguredName],
							};
							const Serv = HBservice.controlService;
							Serv.modeSwitch=set_action.name;
							Serv.eqLogic=eqLogic;
							Serv.actions={};
							Serv.infos={};
							Serv.infos.state=modeState;
							
							Serv.ConfiguredName=ModeName;
							Serv.getCharacteristic(Characteristic.ConfiguredName).setValue(ModeName);
							
							if(!set_state_previous) {
								eqServicesCopy.mode.forEach(function(cmd2) {
									if (cmd2.set_state_previous) {
										Serv.actions.set_state_previous=cmd2.set_state_previous;
										set_state_previous=cmd2.set_state_previous;
									}
								});	
							} else {
								Serv.actions.set_state_previous=set_state_previous;
							}
							
							Serv.cmd_id = modeState.id;
							Serv.eqID = eqLogic.id;
							Serv.subtype = set_action.id || '';
							Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
							
							const set_state_name = set_action.name;
							Serv.actions[set_state_name]={"set_state":set_action};
							
							HBservices.push(HBservice);
							HBservice = null;
						});
					}
				});
			} else {
				that.log('warn','Vous utilisez le type générique Mode en dehors du plugin Mode !');	
			}
		}
		if (eqLogic.services.siren) {
			eqLogic.services.siren.forEach(function(cmd) {
				if(cmd.state) {
					HBservice = {
						controlService : new Service.SecuritySystem(eqLogic.name),
						characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.state=cmd.state;
					Serv.siren=true;

					eqServicesCopy.siren.forEach(function(cmd2) {
						if (cmd2.on) {
							Serv.actions.on=cmd2.on;
						} else if (cmd2.off) {
							Serv.actions.off=cmd2.off;
						}
					});
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					// Serv.getCharacteristic(Characteristic.SecuritySystemCurrentState).setProps({validValues:[3,4]});
					Serv.getCharacteristic(Characteristic.SecuritySystemTargetState).setProps({validValues:[3]});
					Serv.cmd_id = cmd.state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}
		if (eqLogic.services.alarm) {
			eqLogic.services.alarm.forEach(function(cmd) {
				if(cmd.enable_state) {
					HBservice = {
						controlService : new Service.SecuritySystem(eqLogic.name),
						characteristics : [Characteristic.SecuritySystemCurrentState, Characteristic.SecuritySystemTargetState],
					};
					const Serv = HBservice.controlService;
					Serv.eqLogic=eqLogic;
					Serv.actions={};
					Serv.infos={};
					Serv.infos.enable_state=cmd.enable_state;
					Serv.alarm={};
					eqServicesCopy.alarm.forEach(function(cmd2) {
						if (cmd2.state) {
							Serv.infos.state=cmd2.state;
						} else if (cmd2.mode) {
							Serv.infos.mode=cmd2.mode;
						}
					});
					
					// add Active, Tampered and Defect Characteristics if needed
					HBservice=that.createStatusCharact(HBservice,eqServicesCopy);
					
					var props = {};
					props.validValues=[];
					Serv.hasAlarmModes=false;
					if(eqLogic.alarmModes) {
						if(eqLogic.alarmModes.SetModePresent && eqLogic.alarmModes.SetModePresent != "NOT") {
							Serv.alarm.present = {};
							const splitted = eqLogic.alarmModes.SetModePresent.split('|');
							Serv.alarm.present.mode_label = splitted[1];
							Serv.alarm.present.mode_id = splitted[0];
							props.validValues.push(Characteristic.SecuritySystemTargetState.STAY_ARM);
							Serv.hasAlarmModes=true;
						} else {
							that.log('warn','Pas de config du mode Domicile/Présence');
						}
						if(eqLogic.alarmModes.SetModeAbsent && eqLogic.alarmModes.SetModeAbsent != "NOT") {
							Serv.alarm.away = {};
							const splitted = eqLogic.alarmModes.SetModeAbsent.split('|');
							Serv.alarm.away.mode_label = splitted[1];
							Serv.alarm.away.mode_id = splitted[0];
							props.validValues.push(Characteristic.SecuritySystemTargetState.AWAY_ARM);
							Serv.hasAlarmModes=true;
						} else {
							that.log('warn','Pas de config du mode À distance/Absence');
						}
						if(eqLogic.alarmModes.SetModeNuit && eqLogic.alarmModes.SetModeNuit != "NOT") {
							Serv.alarm.night = {};
							const splitted = eqLogic.alarmModes.SetModeNuit.split('|');
							Serv.alarm.night.mode_label = splitted[1];
							Serv.alarm.night.mode_id = splitted[0];
							props.validValues.push(Characteristic.SecuritySystemTargetState.NIGHT_ARM);
							Serv.hasAlarmModes=true;
						} else {
							that.log('warn','Pas de config du mode Nuit');
						}
					}
					if(that.myPlugin == "homebridge" && !Serv.hasAlarmModes) {
						props.validValues.push(Characteristic.SecuritySystemTargetState.AWAY_ARM);
						that.log('warn','Pas de config des modes de l\'alarme');
					}
					props.validValues.push(Characteristic.SecuritySystemTargetState.DISARM);
					Serv.getCharacteristic(Characteristic.SecuritySystemTargetState).setProps(props);
					Serv.cmd_id = cmd.enable_state.id;
					Serv.eqID = eqLogic.id;
					Serv.subtype = Serv.subtype || '';
					Serv.subtype = eqLogic.id + '-' + Serv.cmd_id + '-' + Serv.subtype;
					HBservices.push(HBservice);
					HBservice = null;
				}
			});
		}

		if (HBservices.length != 0) {
			if (DEV_DEBUG) {that.log('debug','HBservices : '+JSON.stringify(HBservices));}
			createdAccessory = that.createAccessory(HBservices, eqLogic);
			that.addAccessory(createdAccessory);
			HBservices = [];
		}
		else
		{
			that.log('│ Accessoire sans Type Générique d\'Etat');
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

JeedomPlatform.prototype.adaptiveLightingSupport = function() {
	if(this.adaptiveEnabled) {
		return (this.api.versionGreaterOrEqual && this.api.versionGreaterOrEqual('v1.3.0-beta.23'));
	} else {
		return false;	
	}
};

// -- createStatusCharact
// -- Desc : Create StatusTampered, StatusFault and StatusActive Characteristics if exists
// -- Params --
// -- HBservice : translated homebridge service
// -- eqLogic : the jeedom eqLogic
JeedomPlatform.prototype.createStatusCharact = function(HBservice,services) {
	const Serv = HBservice.controlService;
	Serv.statusArr = {};
	let sabotage,defect,status_active;
	if(services.sabotage) {
		for(const s in services.sabotage) { if(services.sabotage[s] !== null) {sabotage=services.sabotage[s];break;} }
		if(sabotage) {
			HBservice.characteristics.push(Characteristic.StatusTampered);
			Serv.addCharacteristic(Characteristic.StatusTampered);
			Serv.statusArr.sabotage =sabotage.sabotage;
			Serv.sabotageInverted = 0;
			if(sabotage.sabotage.display) {
				Serv.sabotageInverted = sabotage.sabotage.display.invertBinary;
			}
		}
	}
	if(services.defect) {
		for(const s in services.defect) { if(services.defect[s] !== null) {defect=services.defect[s]; break;} }
		if(defect) {
			HBservice.characteristics.push(Characteristic.StatusFault);
			Serv.addCharacteristic(Characteristic.StatusFault);
			Serv.statusArr.defect=defect.defect;
		}
	}
	if(services.status_active) {
		for(const s in services.status_active) { if(services.status_active[s] !== null) {status_active=services.status_active[s]; break;} }
		if(status_active) {
			HBservice.characteristics.push(Characteristic.StatusActive);
			Serv.addCharacteristic(Characteristic.StatusActive);
			Serv.statusArr.status_active=status_active.status_active;
		}
	}
	return HBservice;
};

// -- createAccessory
// -- Desc : Create the JeedomBridgedAccessory object
// -- Params --
// -- HBservices : translated homebridge services
// -- eqLogic : the jeedom eqLogic
JeedomPlatform.prototype.createAccessory = function(HBservices, eqLogic) {
	try{
		
		const accessory = new JeedomBridgedAccessory(HBservices);
		accessory.platform = this;
		accessory.log = this.log;
		accessory.name = eqLogic.name;

		accessory.UUID = UUIDGen.generate(eqLogic.id + accessory.name);
		accessory.context = {};
		accessory.context.uniqueSeed = eqLogic.id + accessory.name;
		accessory.context.eqLogic = eqLogic;
		
		accessory.model = ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name);
		accessory.manufacturer = this.rooms[eqLogic.object_id] +'>'+eqLogic.origName+((eqLogic.pseudo)?' ('+accessory.name+')':'');
		accessory.serialNumber = '<'+eqLogic.id+(eqLogic.logicalId && typeof eqLogic.logicalId === 'string' ? '-'+eqLogic.logicalId.replace(/\//g,'\\') : '')+'-'+this.config.name+'>';
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

		if(!silence) {this.log('debug',' Vérification d\'existance de l\'accessoire dans le cache Homebridge...');}
		existingAccessory = this.existingAccessory(jeedomAccessory.UUID,silence);
		if(existingAccessory)
		{
			if(!silence) {this.log('│ Suppression de l\'accessoire (' + jeedomAccessory.name + ')');}
			this.api.unregisterPlatformAccessories('homebridge-jeedom', 'Jeedom', [existingAccessory]);
			delete this.accessories[jeedomAccessory.UUID];
			existingAccessory.reviewed=true;
		}
		else if(!silence) {
			this.log('│ KO : Accessoire Ignoré');
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
	var HBAccessory,numberOpened,lastAct;
	try{
		if (!jeedomAccessory) {
			return;
		}
		let isNewAccessory = false;
		const services2Add = jeedomAccessory.services_add;
		this.log('debug',' Vérification d\'existance de l\'accessoire dans le cache Homebridge...');
		HBAccessory = this.existingAccessory(jeedomAccessory.UUID);
		if (!HBAccessory) {
			this.log('│ Nouvel accessoire (' + jeedomAccessory.name + ')');
			isNewAccessory = true;
			HBAccessory = new Accessory(jeedomAccessory.name, jeedomAccessory.UUID);
			jeedomAccessory.initAccessory(HBAccessory);
			this.accessories[jeedomAccessory.UUID] = HBAccessory;
		}
		if(this.fakegato) {
			numberOpened = HBAccessory.context && HBAccessory.context.eqLogic && HBAccessory.context.eqLogic.numberOpened || 0;
			lastAct = HBAccessory.context && HBAccessory.context.eqLogic && HBAccessory.context.eqLogic.lastAct || 0;
		}
		HBAccessory.context = jeedomAccessory.context;
		if(this.fakegato) {
			HBAccessory.context.eqLogic.numberOpened=numberOpened;
			HBAccessory.context.eqLogic.lastAct=lastAct;
		} else {
			HBAccessory.context.eqLogic.numberOpened=undefined;
			HBAccessory.context.eqLogic.lastAct=undefined;
			const exec = require('child_process').exec;
			exec('sudo rm -f '+this.pathHomebridgeConf+'*_persist.json');
		}

		// No more supported by HAP-NodeJS
		// HBAccessory.reachable = true;
		// HBAccessory.updateReachability(true);
		
		if(!isNewAccessory) {
			const cachedValues=jeedomAccessory.delServices(HBAccessory);
			jeedomAccessory.addServices(HBAccessory,services2Add,cachedValues);
		}

		if(this.fakegato && HBAccessory.context.eqLogic.hasLogging && HBAccessory.context.eqLogic.loggingService) {
			const loggingServiceParams = HBAccessory.context.eqLogic.loggingService;
			if(DEV_DEBUG) {
				HBAccessory.log = {};
				HBAccessory.log.debug = function()	{
					const args = [].slice.call(arguments, 0);
					args.unshift('debug');
					return this.log.apply(this,args);
				}.bind(this);
			}
			HBAccessory.context.eqLogic.loggingService = new FakeGatoHistoryService(loggingServiceParams.type,HBAccessory,loggingServiceParams.options);
			HBAccessory.context.eqLogic.loggingService.subtype = loggingServiceParams.subtype;
			HBAccessory.context.eqLogic.loggingService.cmd_id = loggingServiceParams.cmd_id;
			// HBAccessory.addService(HBAccessory.context.eqLogic.loggingService);
			this.log('debug',' Ajout service History :'+HBAccessory.displayName+' subtype:'+HBAccessory.context.eqLogic.loggingService.subtype+' cmd_id:'+HBAccessory.context.eqLogic.loggingService.cmd_id+' UUID:'+HBAccessory.context.eqLogic.loggingService.UUID);
		}
										
		if(HBAccessory.context.eqLogic.hasAdaptive) {
			const adaptiveLightingController = new AdaptiveLightingController(HBAccessory.getService(Service.Lightbulb));
			HBAccessory.configureController(adaptiveLightingController);
			HBAccessory.adaptiveLightingController = adaptiveLightingController;
		} else {
			HBAccessory.adaptiveLightingController = null;
		}
		
		if (isNewAccessory) {
			this.log('│ OK : Ajout de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', [HBAccessory]);
		}else{
			this.log('│ OK : Mise à jour de l\'accessoire (' + jeedomAccessory.name + ')');
			this.api.updatePlatformAccessories([HBAccessory]);
		}
		HBAccessory.on('identify', function(paired, callback) {
			this.log(HBAccessory.displayName, "->Identifié!!!");
			if(typeof callback === 'function') {callback();}
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
		for (const a in this.accessories) {
			if (this.accessories.hasOwnProperty(a)) {
				if (this.accessories[a].UUID == UUID) {
					if(!silence) {this.log('debug',' Accessoire déjà existant dans le cache Homebridge');}
					return this.accessories[a];
				}
			}
		}
		if(!silence) {this.log('debug',' Accessoire non existant dans le cache Homebridge');}
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
		// this.log('debug',JSON.stringify(accessory).replace("\n",""));
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
		
		for (let s = 0; s < accessory.services.length; s++) {
			const service = accessory.services[s];
			for (let i = 0; i < service.characteristics.length; i++) {
				const characteristic = service.characteristics[i];
				if (characteristic.props.needsBinding) {
					this.bindCharacteristicEvents(characteristic, service);
				}
			}
		}
		this.log('debug','Accessoire en cache: ' + accessory.displayName);
		this.accessories[accessory.UUID] = accessory;
		// accessory.reachable = true;
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
		for (var i = 0; i < characteristic.props.perms.length; i++) {
			if (characteristic.props.perms[i] == 'pw') {
				readOnly = false;
			}
		}
		this.subscribeUpdate(service, characteristic);
		if (!readOnly) {
			characteristic.on('set', function(value, callback, context) {
				if (context !== 'fromJeedom' && context !== 'fromSetValue') { // from Homekit
					this.log('info','[Commande d\'Homekit]','Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+characteristic.value+'->'+value,'\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
					this.setAccessoryValue(value,characteristic,service);
				} else {
					this.log('info','[Commande de Jeedom]','Nom:'+characteristic.displayName+'('+characteristic.UUID+'):'+value,'\t\t\t\t\t|||context:'+JSON.stringify(context),'characteristic:'+JSON.stringify(characteristic));
				}
				callback();
			}.bind(this));
		}
		characteristic.on('get', function(callback) {
			let returnValue = this.getAccessoryValue(characteristic, service);
			if(returnValue !== undefined && returnValue !== 'no_response') {
				returnValue = sanitizeValue(returnValue,characteristic);
				this.log('info','[Demande d\'Homekit]','Nom:'+service.displayName+'>'+characteristic.displayName+'='+characteristic.value,'('+returnValue+')','\t\t\t\t\t|||characteristic:'+JSON.stringify(characteristic));
				callback(undefined, returnValue);
			} else if(returnValue === 'no_response') {
				callback('no_response');
			} else {
				callback();
			}
		}.bind(this));
		
		if (this.fakegato) {
			characteristic.on('change', function(_callback) {
				this.changeAccessoryValue(characteristic, service);
			}.bind(this));
		}
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
// -- Return : nothing
JeedomPlatform.prototype.setAccessoryValue = function(value, characteristic, service) {
	try{
		const that = this;
		
		var action,rgb,cmdId;
		switch (characteristic.UUID) {
			case Characteristic.ConfiguredName.UUID :
				this.log('debug','Set ConfiguredName - do nothing');
			break;
			case Characteristic.ResetTotal.UUID :
				this.log('info','--Reset Graphiques Reçu');
				service.eqLogic.numberOpened = 0;
			break;
			case Characteristic.On.UUID :
				if(service.infos.scenario) {
					if(value == 0) {
						// off
						action = 'stop';
						cmdId = service.cmd_id;
						
						that.jeedomClient.executeScenarioAction(cmdId, action).then(function(response) {
							that.log('info','[Commande Scenario envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'response:'+JSON.stringify(response));
						}).catch(function(err) {
							that.log('error','Erreur à l\'envoi de la commande Scenario ' + action + ' vers ' + cmdId , err);
							if(err && err.stack) { console.error(err.stack); }
						});
					} else {
						// on
						action = 'run';
						cmdId = service.cmd_id;
						
						that.jeedomClient.executeScenarioAction(cmdId, action).then(function(response) {
							that.log('info','[Commande Scenario envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'response:'+JSON.stringify(response));
						}).catch(function(err) {
							that.log('error','Erreur à l\'envoi de la commande Scenario ' + action + ' vers ' + cmdId , err);
							if(err && err.stack) { console.error(err.stack); }
						});
					}
				} else if (service.actions.Push){
					if(value == 1) {
						this.command('Pushed', null, service);
						setTimeout(function() {
							characteristic.updateValue(sanitizeValue(false,characteristic), undefined, 'fromSetValue');
						}, 100);
					}	
				} else if (service.modeSwitch) { // modes plugin
					if(value == 0) {// turnOff
						// execute set mode Previous
						that.log('debug','info about previous mode',service);
						this.command('modeSetPrevious', null, service);
					} else {// turnOn
						that.log('debug','info about mode',service);
						this.command('modeSet', null, service);
					}
				} else {
					if(service.eqLogic.hasAdaptive) {
						if(service.eqLogic.doesLightOnWhenTempColIsChanged) {
							if(value == 0) {
								this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
							}
						}
					}
					this.command(value == 0 ? 'turnOff' : 'turnOn', null, service);
				}
			break;	
			case Characteristic.Active.UUID :
				this.command(value == 0 ? 'turnOff' : 'turnOn', null, service);
			break;
			case Characteristic.LockPhysicalControls.UUID :				
				this.command(value == 0 ? 'turnOff' : 'turnOn', null, service);
			break;
			case Characteristic.Mute.UUID :
				this.command(value == 0 ? 'Unmute' : 'Mute', null, service);
			break;
			case Characteristic.TargetTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevel', value, service);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.updateValue(sanitizeValue(value,characteristic), undefined, 'fromSetValue');
				}, 100);
			break;
			case Characteristic.CoolingThresholdTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevelC', value, service);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.updateValue(sanitizeValue(value,characteristic), undefined, 'fromSetValue');
				}, 100);			
			break;
			case Characteristic.HeatingThresholdTemperature.UUID :
				if (Math.abs(value - characteristic.value) >= 0.5) {
					value = parseFloat((Math.round(value / 0.5) * 0.5).toFixed(1));
					this.command('setTargetLevelH', value, service);
				} else {
					value = characteristic.value;
				}
				setTimeout(function() {
					characteristic.updateValue(sanitizeValue(value,characteristic), undefined, 'fromSetValue');
				}, 100);			
			break;
			case Characteristic.TimeInterval.UUID :
				this.command('setTime', value + Math.trunc((new Date()).getTime() / 1000), service);
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				this.log('debug','set target mode:',value);
				this.command('TargetHeatingCoolingState', value, service);
			break;
			case Characteristic.TargetDoorState.UUID :
				if(service.actions.toggle) {
					if(service.actions.toggle.configuration && service.actions.toggle.configuration.hkService == "garage-door-opener") {
						this.log('debug','Reconnu toggle Select de hkControl:',value);
						if(parseInt(value) === 0) {
							this.command('GBtoggleSelect', parseInt(value), service);
						} else { // value === 1
							this.command('GBtoggleSelect', parseInt(value), service);
						}						
					} else {
						this.command('GBtoggle', 0, service);
					}
				} else if(service.actions.on && parseInt(value) === 0){
					this.command('GBopen', 0, service);
				} else if(service.actions.off && parseInt(value) === 1){
					this.command('GBclose', 0, service);
				}
			break;
			case Characteristic.LockTargetState.UUID :
				if (DEV_DEBUG) {this.log('debug','LockTargetState value :',value);}
				service.target=value;
				action = value === Characteristic.LockTargetState.UNSECURED ? 'unsecure' : 'secure';
				this.command(action, 0, service);
			break;
			case Characteristic.SecuritySystemTargetState.UUID:
				if(service.alarm) {
					this.command('SetAlarmMode', value, service);
				}
			break;
			case Characteristic.CurrentPosition.UUID:
			case Characteristic.TargetPosition.UUID:
			case Characteristic.PositionState.UUID: // could be Service.Window or Service.Door too so we check
				if (service.UUID == Service.WindowCovering.UUID) {
					if(service.FlapType=="Closing") { // flap in percent Closing (100% = closed / 0% = open)
						if(service.actions.down && service.actions.up) {
							if (service.actions.slider) {
								if (parseInt(value) === service.minValue) {
									action = 'flapUp';
								} else if (parseInt(value) === service.maxValue) {
									action = 'flapDown';
								} else {
									action = 'setValue';
									const oldValue = value;
									value = 100 - parseInt(value);// invert percentage
									value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue); // transform from percentage to scale
									this.log('debug','---------set Inverted Blinds Value:',oldValue,'% soit ',value,'/',service.maxValue);
								}
							}
							else if (parseInt(value) < ((service.maxValue-service.minValue)/2)) {
								action = 'flapUp';
							} else {
								action = 'flapDown';
							}
							
						} else if (service.actions.slider) {
							action = 'setValue';
							const oldValue = value;
							value = 100 - parseInt(value);// invert percentage
							value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue); // transform from percentage to scale
							this.log('debug','---------set Inverted Blinds Value:',oldValue,'% soit ',value,'/',service.maxValue);
						}
					} else if (service.FlapType=="Opening") { // flap in percent Opening (100% = open / 0% = closed)
						if(service.actions.down && service.actions.up) {
							if (service.actions.slider) {
								if (parseInt(value) === service.minValue) {
									action = 'flapDown';
								} else if (parseInt(value) === service.maxValue) {
									action = 'flapUp';
								} else {
									action = 'setValue';
									value = parseInt(value);
									const oldValue = value;
									value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue);// transform from percentage to scale
									this.log('debug','---------set Blinds Value:',oldValue,'% soit ',value,'/',service.maxValue);
								}
							}
							else if (parseInt(value) < ((service.maxValue-service.minValue)/2)) {
								action = 'flapDown';
							} else {
								action = 'flapUp';
							}
						}
						else if (service.actions.slider) {
							action = 'setValue';
							value = parseInt(value);
							const oldValue = value;
							value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue);// transform from percentage to scale
							this.log('debug','---------set Blinds Value:',oldValue,'% soit ',value,'/',service.maxValue);
						}
					}
					

					this.command(action, value, service);
				}
				if (service.UUID == Service.Window.UUID) {
					if(service.actions.down && service.actions.up) {
						if (service.actions.slider) {
							if (parseInt(value) === service.minValue) {
								action = 'windowDown';
							} else if (parseInt(value) === service.maxValue) {
								action = 'windowUp';
							} else {
								action = 'setValue';
								value = parseInt(value);
								const oldValue = value;
								value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue);
								this.log('debug','---------set WindowMoto Value:',oldValue,'% soit ',value,'/',service.maxValue);
							}
						}
						else if (parseInt(value) < ((service.maxValue-service.minValue)/2)) {
							action = 'windowDown';
						} else {
							action = 'windowUp';
						}
					}
					else if (service.actions.slider) {
						action = 'setValue';
						value = parseInt(value);
						const oldValue = value;
						value = Math.round(((value / 100)*(service.maxValue-service.minValue))+service.minValue);
						this.log('debug','---------set WindowMoto Value:',oldValue,'% soit ',value,'/',service.maxValue);
					}

					this.command(action, value, service);
				}
			break;
			case Characteristic.TargetHorizontalTiltAngle.UUID :
				this.command('setValueHorTilt', value, service);
			break;
			case Characteristic.TargetVerticalTiltAngle.UUID :
				this.command('setValueVerTilt', value, service);
			break;
			case Characteristic.ColorTemperature.UUID :
				this.log('debug',"ColorTemperature set : ",value);
				/* if(service.eqLogic.hasAdaptive) {
					if(this.findAccessoryByService(service).adaptiveLightingController.isAdaptiveLightingActive) {
						this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
					} 
				} */
				if(service.colorTempType=="kelvin")	{
						value = parseInt(1000000/value);
						this.log('debug',"Conversion en mired : ",value);
				} 
				this.command('setValueTemp', value, service);
			break;
			case Characteristic.Hue.UUID :
				this.log('debug',"Hue set : ",value);
				// this.command("setValue",value,service);
				/* if(service.eqLogic.hasAdaptive) {
					if(this.findAccessoryByService(service).adaptiveLightingController.isAdaptiveLightingActive) {
						this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
					} 
				} */
				rgb = this.updateJeedomColorFromHomeKit(value, null, null, service);
				this.syncColorCharacteristics(rgb, service);
			break;
			case Characteristic.Saturation.UUID :
				this.log('debug',"Sat set : ",value);
				// this.command("setValue",value,service);
				/* if(service.eqLogic.hasAdaptive) {
					if(this.findAccessoryByService(service).adaptiveLightingController.isAdaptiveLightingActive) {
						this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
					} 
				} */
				rgb = this.updateJeedomColorFromHomeKit(null, value, null, service);
				this.syncColorCharacteristics(rgb, service);
			break;
			case Characteristic.Brightness.UUID : {
				this.settingLight=true;
				const maxJeedom = parseInt(service.maxBright) || 100;
				value = parseInt(value);
				const oldValue=value;
				if(maxJeedom) {
					value = Math.round((value / 100)*maxJeedom);
				}
				this.log('debug','---------set Bright:',oldValue,'% soit',value,' / ',maxJeedom);
				// pre-change cache !!
				if(service.eqLogic.hasAdaptive) {
					this.log('debug','***Pre-Change Cache !');
					this.jeedomClient.updateModelInfo(service.cmd_id,value,true); // Update cachedModel
				}
				// end !
				this.command('setValueBright', value, service);
			break;}
			case Characteristic.RotationSpeed.UUID : {
				this.settingFan=true;
				const maxJeedomP = parseInt(service.maxPower) || 100;
				value = parseInt(value);
				const oldValueP=value;
				if(maxJeedomP) {
					value = Math.round((value / 100)*maxJeedomP);
				}
				this.log('debug','---------set Power:',oldValueP,'% soit',value,' / ',maxJeedomP);
				this.command('setValue', value, service);
			break;}
			default :
				this.command('setValue', value, service);
			break;
		}
	
	}
	catch(e){
		this.log('error','Erreur de la fonction setAccessoryValue :',e);
		console.error(e.stack);
	}
};

JeedomPlatform.prototype.findAccessoryByService = function(service) {
	for (const acc in this.accessories) {
		if (this.accessories.hasOwnProperty(acc)) {
			for(const ser in this.accessories[acc].services) {
				if (this.accessories[acc].services.hasOwnProperty(ser)) {
					if(this.accessories[acc].services[ser].cmd_id && this.accessories[acc].services[ser].cmd_id.toString() == service.cmd_id.toString()) {
						return this.accessories[acc];
					}
				}
			}
		}
	}
};

JeedomPlatform.prototype.changeAccessoryValue = function(characteristic, service) {
		const that = this;
		const cmdList = that.jeedomClient.getDeviceCmdFromCache(service.eqID);

		switch (characteristic.UUID) {
			case Characteristic.ContactSensorState.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'OPENING' || cmd.generic_type == 'OPENING_WINDOW') && cmd.id == service.cmd_id) {
						
						if(that.fakegato) {
							const realValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
							if(realValue === false) {
								service.eqLogic.numberOpened++;
							}
							service.eqLogic.lastAct=Math.round(new Date().valueOf() / 1000)-service.eqLogic.loggingService.getInitialTime();
							that.api.updatePlatformAccessories([this.findAccessoryByService(service)]);
						}
						break;
					}
				}
			break;	
			case Characteristic.MotionDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'PRESENCE' && cmd.id == service.cmd_id) {
						if(that.fakegato) {
							service.eqLogic.lastAct=Math.round(new Date().valueOf() / 1000)-service.eqLogic.loggingService.getInitialTime();
							that.api.updatePlatformAccessories([this.findAccessoryByService(service)]);
						}
						break;
					}
				}
			break;				
		}
};

// -- getAccessoryValue
// -- Desc : Get the value of an accessory in the jeedom local cache
// -- Params --
// -- characteristic : characteristic to get the value from
// -- service : service in which the characteristic is
// -- Return : nothing
JeedomPlatform.prototype.getAccessoryValue = function(characteristic, service, info=null) {
	try{
		const that = this;
		
		let customizedValues={};
		if(service.customizedValues) {
			customizedValues=service.customizedValues;
		} else {
			customizedValues={'OPEN':255,'OPENING':254,'STOPPED':253,'CLOSING':252,'CLOSED':0,'SINGLE':0,'DOUBLE':1,'LONG':2};
		}
		
		let returnValue = 0;
		let HRreturnValue;
		const cmdList = that.jeedomClient.getDeviceCmdFromCache(service.eqID);
		let targetValueToTest,currentValueToTest;
		let hsv,mode_PRESENT,mode_AWAY,mode_NIGHT,mode_CLIM,mode_CHAUF;
		
		// masterSwitch :
		switch (characteristic.UUID) {
			// Switch or Light
			case Characteristic.ConfiguredName.UUID :
				if(service.ConfiguredName != null && service.ConfiguredName != "") {
					returnValue = service.ConfiguredName;
				} else {
					returnValue = undefined;
				}
			break;
			case Characteristic.On.UUID :
				if(service.infos.scenario) {
					const scenario = that.jeedomClient.getScenarioPropertiesFromCache(service.infos.scenario.id);
					switch(scenario.state) {
						case 'stop':
							returnValue = false;
						break;
						case 'in progress':
							returnValue = true;
						break;
					}
					if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
						service.eqLogic.loggingService.addEntry({
							time: Math.round(new Date().valueOf() / 1000),
							status: ((returnValue)?1:0),
						});
					}
					
				} else if(service.modeSwitch){
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'MODE_STATE' && cmd.id == service.cmd_id) {
							if(service.actions[cmd.currentValue] !== undefined) {
								returnValue = true;
							} else {
								returnValue = false;
							}
							
							// returnValue=toBool(cmd.currentValue);
							break;
						} 
					}
				} else {
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'LIGHT_STATE' && cmd.id == service.cmd_id && !service.infos.state_bool && (cmd.subType == 'binary' || cmd.subType == 'numeric')) {
							if(parseInt(cmd.currentValue) == 0) {returnValue=false;}
							else {returnValue=true;}
							
							if(service.eqLogic.hasAdaptive) {
								if(service.eqLogic.doesLightOnWhenTempColIsChanged) {
									if(returnValue == false) {
										this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
									}
								}
							}
							break;
						} else if (cmd.generic_type == 'LIGHT_STATE_BOOL' && service.infos.state_bool && cmd.id == service.infos.state_bool.id) {
							returnValue=true;
							if((cmd.subType == 'other' || cmd.subType == 'string') && cmd.currentValue.toLowerCase() == 'off') {
								returnValue=false;
							} else if(parseInt(cmd.currentValue) == 0) {
								returnValue=false;
							}

							if(service.eqLogic.hasAdaptive) {
								if(service.eqLogic.doesLightOnWhenTempColIsChanged) {
									if(returnValue == false) {
										this.findAccessoryByService(service).adaptiveLightingController.disableAdaptiveLighting();
									}
								}
							}
							break;
						} else if ((cmd.generic_type == 'FAN_STATE' || cmd.generic_type == 'FAN_SPEED_STATE') && cmd.id == service.cmd_id) {
							if(parseInt(cmd.currentValue) == 0) {returnValue=false;}
							else {returnValue=true;}
							break;
						} else if (cmd.generic_type == "ENERGY_STATE" && cmd.id == service.cmd_id) {
							returnValue = cmd.currentValue;
							break;
						} else if ((cmd.generic_type == "SWITCH_STATE" || cmd.generic_type == "CAMERA_RECORD_STATE") && cmd.id == service.cmd_id) {
							returnValue = cmd.currentValue;
							if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
								service.eqLogic.loggingService.addEntry({
									time: Math.round(new Date().valueOf() / 1000),
									status: ((returnValue)?1:0),
								});
							}
							break;
						} else if (PushButtonAssociated.indexOf(cmd.generic_type) != -1 && service.actions.Push && cmd.id == service.actions.Push.id) {
							returnValue = false;
							break;
						} else if (cmd.generic_type == "GENERIC_ACTION" && cmd.subType == 'other' && service.actions.Push && cmd.id == service.actions.Push.id) {
							returnValue = false;
							break;
						}
					}
				}
			break;
			case Characteristic.InUse.UUID :
			case Characteristic.Active.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'FAUCET_STATE' || cmd.generic_type == 'IRRIG_STATE' || cmd.generic_type == 'VALVE_STATE') && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.ValveType.UUID :
				returnValue = service.ValveType;
			break;
			case Characteristic.LockPhysicalControls.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_LOCK' && cmd.id == service.infos.lock.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			// Generics
			case Characteristic.TimesOpened.UUID :
				that.log('info','Demande du nombre d\'ouverture de la porte',service.eqLogic.numberOpened);
				returnValue = service.eqLogic.numberOpened;
			break;
			case Characteristic.LastActivation.UUID :
				that.log('info','Demande de la dernière activation',service.eqLogic.lastAct);
				returnValue = service.eqLogic.lastAct;
			break;
			case Characteristic.ServiceLabelIndex.UUID :
				returnValue = service.ServiceLabelIndex || 1;
			break;
			case Characteristic.ServiceLabelNamespace.UUID :
				returnValue = Characteristic.ServiceLabelNamespace.ARABIC_NUMERALS;
			break;
			case Characteristic.AirQuality.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'AIRQUALITY_INDEX' || cmd.generic_type == 'CO2' || cmd.generic_type == 'AIRQUALITY_CUSTOM') && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						if(Array.isArray(service.levelNum)) {
							if(returnValue >= 0 && returnValue <= service.levelNum[Characteristic.AirQuality.EXCELLENT]) {
								returnValue = Characteristic.AirQuality.EXCELLENT;
							} else if(returnValue > service.levelNum[Characteristic.AirQuality.EXCELLENT] && returnValue <= service.levelNum[Characteristic.AirQuality.GOOD]) {
								returnValue = Characteristic.AirQuality.GOOD;
							} else if(returnValue > service.levelNum[Characteristic.AirQuality.GOOD] && returnValue <= service.levelNum[Characteristic.AirQuality.FAIR]) {
								returnValue = Characteristic.AirQuality.FAIR;
							} else if(returnValue > service.levelNum[Characteristic.AirQuality.FAIR] && returnValue <= service.levelNum[Characteristic.AirQuality.INFERIOR]) {
								returnValue = Characteristic.AirQuality.INFERIOR;
							} else if(returnValue > service.levelNum[Characteristic.AirQuality.INFERIOR] && returnValue <= service.levelNum[Characteristic.AirQuality.POOR]) {
								returnValue = Characteristic.AirQuality.POOR;
							} else {
								returnValue = Characteristic.AirQuality.UNKNOWN;
							}
						} else {
							returnValue = Characteristic.AirQuality.UNKNOWN;
						}
						break;
					}
				}
			break;
			case Characteristic.NoiseQuality.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'NOISE' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						if(Array.isArray(service.levelNum)) {
							if(returnValue >= 0 && returnValue <= service.levelNum[Characteristic.NoiseQuality.SILENT]) {
								returnValue = Characteristic.NoiseQuality.SILENT;
							} else if(returnValue > service.levelNum[Characteristic.NoiseQuality.SILENT] && returnValue <= service.levelNum[Characteristic.NoiseQuality.CALM]) {
								returnValue = Characteristic.NoiseQuality.CALM;
							} else if(returnValue > service.levelNum[Characteristic.NoiseQuality.CALM] && returnValue <= service.levelNum[Characteristic.NoiseQuality.LIGHTLYNOISY]) {
								returnValue = Characteristic.NoiseQuality.LIGHTLYNOISY;
							} else if(returnValue > service.levelNum[Characteristic.NoiseQuality.LIGHTLYNOISY] && returnValue <= service.levelNum[Characteristic.NoiseQuality.NOISY]) {
								returnValue = Characteristic.NoiseQuality.NOISY;
							} else if(returnValue > service.levelNum[Characteristic.NoiseQuality.NOISY] && returnValue <= service.levelNum[Characteristic.NoiseQuality.TOONOISY]) {
								returnValue = Characteristic.NoiseQuality.TOONOISY;
							} else {
								returnValue = Characteristic.NoiseQuality.UNKNOWN;
							}
						} else {
							returnValue = Characteristic.NoiseQuality.UNKNOWN;
						}
						break;
					}
				}
			break;
			case Characteristic.AQI.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'AIRQUALITY_INDEX' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						break;
					}
				}
			break;
			case Characteristic.PPM.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CO2' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								ppm: returnValue,
							});
						}
						break;
					}
				}
			break;	
			case Characteristic.VOCDensity.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'AIRQUALITY_CUSTOM' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						if(service.infos.Index && service.infos.Index.unite && service.infos.Index.unite.toLowerCase() == 'ppb') { // unit should be µg/m3 if it's ppb, multiply it by 4.57
							returnValue = parseInt(returnValue*4.57);
						}
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								voc: returnValue,
							});
						}
						break;
					}
				}
			break;
			case Characteristic.CarbonDioxideLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CO2' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						break;
					}
				}
			break;	
			case Characteristic.CarbonDioxideDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CO2' && cmd.id == service.cmd_id) {
						if(parseInt(cmd.currentValue)>=1400) {
							returnValue = Characteristic.CarbonDioxideDetected.CO2_LEVELS_ABNORMAL;
						} else {
							returnValue = Characteristic.CarbonDioxideDetected.CO2_LEVELS_NORMAL;
						}
						break;
					}
				}
			break;
			case Characteristic.CarbonMonoxideDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CO' && cmd.id == service.cmd_id) {
						// returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) {
							returnValue = Characteristic.CarbonMonoxideDetected.CO_LEVELS_NORMAL;
						} else {
							returnValue = Characteristic.CarbonMonoxideDetected.CO_LEVELS_ABNORMAL;
						}					
						break;
					}
				}
			break;
			case Characteristic.NoiseLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'NOISE' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						break;
					}
				}
			break;	
			case Characteristic.AQExtraCharacteristic.UUID :
				returnValue = '';
			break;	
			case Characteristic.PM2_5Density.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'AIRQUALITY_PM25' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						break;
					}
				}
			break;			
			case Characteristic.ContactSensorState.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'OPENING' || cmd.generic_type == 'OPENING_WINDOW') && cmd.id == service.cmd_id) {
						returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
						if(returnValue === false) {
							returnValue = Characteristic.ContactSensorState.CONTACT_NOT_DETECTED;
						} else {
							returnValue = Characteristic.ContactSensorState.CONTACT_DETECTED;
						}
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							/* if(returnValue === Characteristic.ContactSensorState.CONTACT_NOT_DETECTED) {
								service.eqLogic.numberOpened++;
							} */
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								status: returnValue,
							});
						}
						
						break;
					}
				}
			break;
			case Characteristic.CurrentAmbientLightLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BRIGHTNESS' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						/* if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								lux: returnValue,
							});
						} */
						break;
					}
				}
			break;
			case Characteristic.CurrentTemperature.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'TEMPERATURE' && cmd.id == service.cmd_id) || 
						(cmd.generic_type == 'THERMOSTAT_TEMPERATURE' && cmd.id == service.infos.temperature.id) ||
						(cmd.generic_type == 'THERMOSTAT_HC_TEMPERATURE' && cmd.id == service.infos.temperature.id) ||
						(cmd.generic_type == 'WEATHER_TEMPERATURE' && cmd.id == service.infos.temperature.id)) {
						
						returnValue = cmd.currentValue;
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							if (cmd.generic_type == 'TEMPERATURE' || cmd.generic_type == 'WEATHER_TEMPERATURE') {
								service.eqLogic.loggingService.addEntry({
									time: Math.round(new Date().valueOf() / 1000),
									temp: returnValue,
								});
							} else if (cmd.generic_type == 'THERMOSTAT_TEMPERATURE' || cmd.generic_type == 'THERMOSTAT_HC_TEMPERATURE') {
								service.eqLogic.loggingService.addEntry({
									time: Math.round(new Date().valueOf() / 1000),
									currentTemp: returnValue,
								});
							}
						}
						break;
					}
				}
			break;
			case Characteristic.TemperatureDisplayUnits.UUID :
				returnValue = Characteristic.TemperatureDisplayUnits.CELSIUS;
			break;
			case Characteristic.CurrentRelativeHumidity.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'HUMIDITY' && cmd.id == service.cmd_id) ||
						(cmd.generic_type == 'WEATHER_HUMIDITY' && cmd.id == service.infos.humidity.id)) {
						
						returnValue = cmd.currentValue;
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								humidity: returnValue,
							});
						}
						break;
					}
				}
			break;			
			case Characteristic.AirPressure.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'PRESSURE' && cmd.id == service.cmd_id) ||
						(cmd.generic_type == 'WEATHER_PRESSURE' && cmd.id == service.infos.pressure.id)) {
						
						returnValue = cmd.currentValue;
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								pressure: returnValue,
							});
						}
						break;
					}
				}
			break;			
			case Characteristic.WindSpeed.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_WIND_SPEED' && cmd.id == service.infos.wind_speed.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;		
			case Characteristic.WindDirection.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_WIND_DIRECTION' && cmd.id == service.infos.wind_direction.id) {
						returnValue = cmd.currentValue;
						if(!isNaN(returnValue)) { // if numeric
							const key=parseInt((returnValue/22.5)+0.5) % 16;
							const arr=["N","NNE","NE","ENE","E","ESE","SE","SSE","S","SSO","SO","OSO","O","ONO","NO","NNO"];
							returnValue=arr[key];
						}
						break;
					}
				}
			break;	
			case Characteristic.WeatherCondition.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_CONDITION' && cmd.id == service.infos.condition.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			case Characteristic.Rain.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_RAIN' && cmd.id == service.infos.rain.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			case Characteristic.Snow.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_SNOW' && cmd.id == service.infos.snow.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			case Characteristic.MinimumTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_TEMPERATURE_MIN' && cmd.id == service.infos.temperature_min.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			case Characteristic.LeakDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLOOD' && cmd.id == service.cmd_id) {
						// returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) {
							returnValue = Characteristic.LeakDetected.LEAK_NOT_DETECTED;
						} else {
							returnValue = Characteristic.LeakDetected.LEAK_DETECTED;
						}	
						break;
					}
				}
			break;
			case Characteristic.MotionDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'PRESENCE' && cmd.id == service.cmd_id) {
						// returnValue = parseInt(service.invertBinary)==0 ? !toBool(cmd.currentValue) : toBool(cmd.currentValue); // invertBinary ? 
						returnValue = toBool(cmd.currentValue);
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								status: returnValue?1:0,
							});
						}
						break;
					}
				}
			break;		
			case Characteristic.OccupancyDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'OCCUPANCY' && cmd.id == service.cmd_id) {
						// returnValue = parseInt(service.invertBinary)==0 ? !toBool(cmd.currentValue) : toBool(cmd.currentValue); // invertBinary ? 
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) {
							returnValue = Characteristic.OccupancyDetected.OCCUPANCY_NOT_DETECTED;
						} else {
							returnValue = Characteristic.OccupancyDetected.OCCUPANCY_DETECTED;
						}
						break;
					}
				}
			break;				
			case Characteristic.SmokeDetected.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SMOKE' && cmd.id == service.cmd_id) {
						// returnValue = parseInt(service.invertBinary)==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ? // no need to invert
						returnValue = toBool(cmd.currentValue);
						if(returnValue === false) {
							returnValue = Characteristic.SmokeDetected.SMOKE_NOT_DETECTED;
						} else {
							returnValue = Characteristic.SmokeDetected.SMOKE_DETECTED;	
						}					
						break;
					}
				}
			break;
			case Characteristic.UVIndex.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'UV' && cmd.id == service.cmd_id) ||
						(cmd.generic_type == 'WEATHER_UVINDEX' && cmd.id == service.infos.UVIndex.id)) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;		
			case Characteristic.Visibility.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'WEATHER_VISIBILITY' && cmd.id == service.infos.visibility.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;		
			case Characteristic.RotationSpeed.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'FAN_STATE' || cmd.generic_type == 'FAN_SPEED_STATE') && cmd.subType != 'binary' && cmd.id == service.cmd_id) {
						const maxJeedom = parseInt(service.maxPower) || 100;
						returnValue = parseInt(cmd.currentValue);
						if(maxJeedom) {
							returnValue = Math.round((returnValue / maxJeedom)*100);
						}
						if (DEV_DEBUG) {that.log('debug','---------update Power(refresh):',returnValue,'% soit',cmd.currentValue,' / ',maxJeedom);}
						// that.log('debug','------------PowerVentilo jeedom :',cmd.currentValue,'soit en homekit :',returnValue);
						break;
					}
				}
			break;	
			case Characteristic.RemainingDuration.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'VALVE_REMAINING_DURATION') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.SetDuration.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'VALVE_SET_DURATION') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;			
			// Generic_info
			case Characteristic.GenericFLOAT.UUID :
			case Characteristic.GenericINT.UUID :
			case Characteristic.GenericBOOL.UUID :
				for (const cmd of cmdList) {
					if (GenericAssociated.indexOf(cmd.generic_type) != -1 && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;
			case Characteristic.GenericSTRING.UUID : {
				const maxSize = 64;
				for (const cmd of cmdList) {
					if (GenericAssociated.indexOf(cmd.generic_type) != -1 && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue.toString().substring(0,maxSize);
						break;
					}
				}
			break;}
			// Lights
			case Characteristic.Hue.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR') {
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
						returnValue = cmd.currentValue;
						break;
					}
				}
				hsv = that.updateHomeKitColorFromJeedom(returnValue, service);
				returnValue = Math.round(hsv.s);
			break;
			case Characteristic.ColorTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_COLOR_TEMP') {
						if(service.colorTempType=="kelvin") {
							returnValue = parseInt(1000000/cmd.currentValue);
						} else {
							returnValue = cmd.currentValue;
						}
						break;
					}
				}
			break;
			case Characteristic.Brightness.UUID :
				returnValue = 0;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LIGHT_STATE' && cmd.subType != 'binary' && cmd.id == service.cmd_id) {
						const maxJeedom = parseInt(service.maxBright) || 100;
						returnValue = parseInt(cmd.currentValue);
						if(maxJeedom != 0) {
							returnValue = Math.round((returnValue / maxJeedom)*100);
						}
						if (DEV_DEBUG) {that.log('debug','---------update Bright(refresh):',returnValue,'% soit',cmd.currentValue,' / ',maxJeedom);}
						// that.log('debug','------------Brightness jeedom :',cmd.currentValue,'soit en homekit :',returnValue);
						break;
					} else if (cmd.generic_type == 'LIGHT_BRIGHTNESS' && cmd.id == service.infos.brightness.id) {
						const maxJeedom = parseInt(service.maxBright) || 100;
						returnValue = parseInt(cmd.currentValue);
						if(maxJeedom != 0) {
							returnValue = Math.round((returnValue / maxJeedom)*100);
						}
						if (DEV_DEBUG) {that.log('debug','---------update Bright(refresh):',returnValue,'% soit',cmd.currentValue,' / ',maxJeedom);}
						// that.log('debug','------------Brightness jeedom :',cmd.currentValue,'soit en homekit :',returnValue);
						break;
					}
				}
			break;			
			// Alarm
			case Characteristic.SecuritySystemTargetState.UUID :
				/* if(info) {
					cmdList = [info];
				} */
				if(DEV_DEBUG) { 
					console.log('cmdList Target',JSON.stringify(info),JSON.stringify(cmdList)); 
				}
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SIREN_STATE') {
						if (DEV_DEBUG) {that.log('debug',"Siren_state T=",cmd.currentValue);}
						returnValue = Characteristic.SecuritySystemTargetState.DISARM;
						break;
					}
					if(!service.hasAlarmModes) {
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 1) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state T=",cmd.currentValue,"NO MODES");}
							returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
							break;
						} else if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 0) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state T=",cmd.currentValue,"NO MODES");}
							returnValue = Characteristic.SecuritySystemTargetState.DISARM;
							break;
						}
					} else {
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 0) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state T=",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemTargetState.DISARM;
							break;
						}
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 1) {
							// if there is mode and alarm is enabled, will continue the search for mode instead !
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state T=",cmd.currentValue,'return undefined');}
							returnValue = undefined;
							continue;
						}
						if (cmd.generic_type == 'ALARM_MODE') {
							if (DEV_DEBUG) {that.log('debug',"alarm_mode T=",cmd.currentValue);}
							
							if(service.alarm.present && service.alarm.present.mode_label != undefined) {
								mode_PRESENT=service.alarm.present.mode_label?.toLowerCase();
							}
							if(service.alarm.away && service.alarm.away.mode_label != undefined) {
								mode_AWAY=service.alarm.away.mode_label?.toLowerCase();
							}
							if(service.alarm.night && service.alarm.night.mode_label != undefined) {
								mode_NIGHT=service.alarm.night.mode_label?.toLowerCase();
							}
							switch (cmd.currentValue?.toLowerCase()) {
								case undefined:
									if (DEV_DEBUG) {that.log('debug',"renvoie absent T via undefined",Characteristic.SecuritySystemTargetState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
								break;
								default: // back compatibility
									if (DEV_DEBUG) {that.log('debug',"renvoie absent T via default",Characteristic.SecuritySystemTargetState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
								break;							
								case mode_PRESENT:
									if (DEV_DEBUG) {that.log('debug',"renvoie present T",Characteristic.SecuritySystemTargetState.STAY_ARM);}
									returnValue = Characteristic.SecuritySystemTargetState.STAY_ARM;
								break;
								case mode_AWAY:
									if (DEV_DEBUG) {that.log('debug',"renvoie absent T",Characteristic.SecuritySystemTargetState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemTargetState.AWAY_ARM;
								break;
								case mode_NIGHT:
									if (DEV_DEBUG) {that.log('debug',"renvoie nuit T",Characteristic.SecuritySystemTargetState.NIGHT_ARM);}
									returnValue = Characteristic.SecuritySystemTargetState.NIGHT_ARM;
								break;
							}
							break;
						}
					}
				}
			break;
			case Characteristic.SecuritySystemCurrentState.UUID :
				/* if(info) {
					cmdList = [info];
				} */
				if(DEV_DEBUG) { 
					console.log('cmdList Current',cmdList);
					console.log('info Current',info); 
				}
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SIREN_STATE') {
						if (cmd.currentValue == 1) {
							if (DEV_DEBUG) {that.log('debug',"Siren_State C=",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
							break;
						} else if (cmd.currentValue == 0) {
							if (DEV_DEBUG) {that.log('debug',"Siren_state C=",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
							break;
						} else {
							if (DEV_DEBUG) {that.log('debug',"Siren_state C IMPOSSIBLE =",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
							break;
						}
					}
					if (cmd.generic_type == 'ALARM_STATE') {
						if(cmd.currentValue == 1) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_State C=",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemCurrentState.ALARM_TRIGGERED;
							break;
						} else { continue; }
					}
					if (!service.hasAlarmModes) {
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 1) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state C=",cmd.currentValue,"NO MODES");}
							returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
							break;
						} else if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 0) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state C=",cmd.currentValue,"NO MODES");}
							returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
							break;
						}
					} else {
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 0) {
							if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state C=",cmd.currentValue);}
							returnValue = Characteristic.SecuritySystemCurrentState.DISARMED;
							break;
						}
						if (cmd.generic_type == 'ALARM_ENABLE_STATE' && cmd.currentValue == 1) {
								// if there is mode and alarm is enabled, will continue the search for mode instead !
								if (DEV_DEBUG) {that.log('debug',"Alarm_enable_state C=",cmd.currentValue,'return undefined');}
								returnValue = undefined;
								if(info && info.generic_type == 'ALARM_ENABLE_STATE') {
									if (DEV_DEBUG) {that.log('debug',"And break");}
									break;
								} else {
									if (DEV_DEBUG) {that.log('debug',"And continue");}
									continue;
								}
						}
						if (cmd.generic_type == 'ALARM_MODE') {
							if (DEV_DEBUG) {that.log('debug',"alarm_mode C=",cmd.currentValue?.toLowerCase());}
							
							if(service.alarm.present && service.alarm.present.mode_label != undefined) {
								mode_PRESENT=service.alarm.present.mode_label?.toLowerCase();
							}
							if(service.alarm.away && service.alarm.away.mode_label != undefined) {
								mode_AWAY=service.alarm.away.mode_label?.toLowerCase();
							}
							if(service.alarm.night && service.alarm.night.mode_label != undefined) {
								mode_NIGHT=service.alarm.night.mode_label?.toLowerCase();
							}
							switch (cmd.currentValue?.toLowerCase()) {
								case undefined:
									if (DEV_DEBUG) {that.log('debug',"renvoie absent C via undefined",Characteristic.SecuritySystemCurrentState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
								break;
								default: // back compatibility
									if (DEV_DEBUG) {that.log('debug',"renvoie absent C via default",Characteristic.SecuritySystemCurrentState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
								break;							
								case mode_PRESENT:
									if (DEV_DEBUG) {that.log('debug',"renvoie present C",Characteristic.SecuritySystemCurrentState.STAY_ARM);}
									returnValue = Characteristic.SecuritySystemCurrentState.STAY_ARM;
								break;
								case mode_AWAY:
									if (DEV_DEBUG) {that.log('debug',"renvoie absent C",Characteristic.SecuritySystemCurrentState.AWAY_ARM);}
									returnValue = Characteristic.SecuritySystemCurrentState.AWAY_ARM;
								break;
								case mode_NIGHT:
									if (DEV_DEBUG) {that.log('debug',"renvoie nuit C",Characteristic.SecuritySystemCurrentState.NIGHT_ARM);}
									returnValue = Characteristic.SecuritySystemCurrentState.NIGHT_ARM;
								break;
							}
							break;
						}
					}
				}
			break;
			// Thermostats
			case Characteristic.CurrentHeatingCoolingState.UUID :
				// var stateNameFound=false;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_STATE_NAME' || cmd.generic_type == 'THERMOSTAT_HC_STATE_NAME') {
						if(cmd.currentValue != undefined && cmd.currentValue != null) {
							that.log('debug','----Current State Thermo :',cmd.currentValue.toString().toLowerCase());
							switch(cmd.currentValue.toString().toLowerCase()) {
								default:
								case 'off' : // EN
								case 'stopped' : // EN
								case 'arrêté' : // FR
								case 'arret' : // FR
								case 'detenido' : // ES
								case 'apagado' : // ES
								case 'verhaftet' : // DE
								case 'aus' : // DE
								case 'preso' : // PT
								case 'fora' : // PT
									returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
								break;
								case 'heat': // EN
								case 'chauffage' : // FR
								case 'calefacción' : // ES
								case 'heizung' : // DE
								case 'aquecimento' : // PT
									returnValue = Characteristic.CurrentHeatingCoolingState.HEAT;
								break;
								case 'cool': // EN
								case 'climatisation' : // FR
								case 'climatización' : // ES
								case 'klimaanlage' : // DE
								case 'ar condicionado' : // PT
									returnValue = Characteristic.CurrentHeatingCoolingState.COOL;
								break;
							}
							break;
							
						} else {
							returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
						}
						// stateNameFound=true;
					}
				}
				// idea for managing only setpoint + temperature generic types, display Heat if the setpoint > temperature+1 and display cool if setpoint < temperature-1 : to test
				/* if(!stateNameFound) {
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'THERMOSTAT_SETPOINT') {
							if(cmd.currentValue > service.infos.temperature.currentValue+1)
								returnValue = Characteristic.CurrentHeatingCoolingState.HEAT;
							else if (cmd.currentValue < service.infos.temperature.currentValue-1)
								returnValue = Characteristic.CurrentHeatingCoolingState.COOL;
							else
								returnValue = Characteristic.CurrentHeatingCoolingState.OFF;
						}
					}
				} */
			break;
			case Characteristic.TargetHeatingCoolingState.UUID :
				returnValue = Characteristic.TargetHeatingCoolingState.AUTO;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_MODE') {
						
						if(service.thermo.clim && service.thermo.clim.mode_label !== undefined) {
							mode_CLIM=service.thermo.clim.mode_label.toString().toLowerCase();
						}
						if(service.thermo.chauf && service.thermo.chauf.mode_label !== undefined) {
							mode_CHAUF=service.thermo.chauf.mode_label.toString().toLowerCase();
						}
						that.log('debug','TargetThermo :',mode_CLIM,mode_CHAUF,':',cmd.currentValue.toString().toLowerCase());
						switch(cmd.currentValue.toString().toLowerCase()) {
							case 'off' : // EN
							case 'stopped' : // EN
							case 'arrêté' : // FR
							case 'arret' : // FR
							case 'detenido' : // ES
							case 'apagado' : // ES
							case 'verhaftet' : // DE
							case 'aus' : // DE
							case 'preso' : // PT
							case 'fora' : // PT
							case undefined:
								returnValue = Characteristic.TargetHeatingCoolingState.OFF;
							break;							
							case mode_CLIM:
								returnValue = Characteristic.TargetHeatingCoolingState.COOL;
							break;
							case mode_CHAUF:
								returnValue = Characteristic.TargetHeatingCoolingState.HEAT;
							break;
							case 'none': // EN
							case 'aucun': // FR
							case 'thermostat':
							case 'ninguna': // ES
							case 'ohne': // DE
							case 'nemhum': // PT
								returnValue = Characteristic.TargetHeatingCoolingState.AUTO;
							break;
						}
						break;
					} else if (cmd.generic_type == 'THERMOSTAT_HC_MODE') {
						
						if(service.thermoHC.clim && service.thermoHC.clim.mode_label !== undefined) {
							mode_CLIM=service.thermoHC.clim.mode_label.toString().toLowerCase();
						}
						if(service.thermoHC.chauf && service.thermoHC.chauf.mode_label !== undefined) {
							mode_CHAUF=service.thermoHC.chauf.mode_label.toString().toLowerCase();
						}
						that.log('debug','TargetThermo :',mode_CLIM,mode_CHAUF,':',cmd.currentValue.toString().toLowerCase());
						switch(cmd.currentValue.toString().toLowerCase()) {
							case 'off' : // EN
							case 'stopped' : // EN
							case 'arrêté' : // FR
							case 'arret' : // FR
							case 'detenido' : // ES
							case 'apagado' : // ES
							case 'verhaftet' : // DE
							case 'aus' : // DE
							case 'preso' : // PT
							case 'fora' : // PT
							case undefined:
								returnValue = Characteristic.TargetHeatingCoolingState.OFF;
							break;							
							case mode_CLIM:
								returnValue = Characteristic.TargetHeatingCoolingState.COOL;
							break;
							case mode_CHAUF:
								returnValue = Characteristic.TargetHeatingCoolingState.HEAT;
							break;
							case 'none': // EN
							case 'aucun': // FR
							case 'thermostat':
							case 'ninguna': // ES
							case 'ohne': // DE
							case 'nemhum': // PT
								returnValue = Characteristic.TargetHeatingCoolingState.AUTO;
							break;
						}
						break;
					}
				}
			break;
			case Characteristic.TargetTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_SETPOINT') {
						returnValue = cmd.currentValue;
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								setTemp : returnValue,
							});
						}
						break;
					}
				}
			break;	
			case Characteristic.CoolingThresholdTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_HC_SETPOINT_C') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			case Characteristic.HeatingThresholdTemperature.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'THERMOSTAT_HC_SETPOINT_H') {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			// GarageDoor
			case Characteristic.TargetDoorState.UUID :
				HRreturnValue="CLOSEDDef";
				returnValue=Characteristic.TargetDoorState.CLOSED; // if don't know -> CLOSED
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
						cmd.generic_type == 'BARRIER_STATE') {
						targetValueToTest=cmd.currentValue.toString();
						switch(targetValueToTest) {
								case customizedValues.OPEN.toString() :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";	
								break;
								case customizedValues.CLOSED.toString() :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customizedValues.OPENING.toString() :
									returnValue=Characteristic.TargetDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
								case customizedValues.CLOSING.toString() :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customizedValues.STOPPED.toString() :
									returnValue=Characteristic.TargetDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
						}
						if (DEV_DEBUG) {
							console.log(customizedValues);
							that.log('debug','Target Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						}
						break;
					}
				}	
			break;
			case Characteristic.CurrentDoorState.UUID :
				HRreturnValue="STOPPEDDef";
				returnValue=Characteristic.CurrentDoorState.STOPPED; // if don't know -> STOPPED
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'GARAGE_STATE' || 
						cmd.generic_type == 'BARRIER_STATE') {
						currentValueToTest=cmd.currentValue.toString();
						switch(currentValueToTest) {
								case customizedValues.OPEN.toString() :
									returnValue=Characteristic.CurrentDoorState.OPEN; // 0
									HRreturnValue="OPEN";
								break;
								case customizedValues.CLOSED.toString() :
									returnValue=Characteristic.CurrentDoorState.CLOSED; // 1
									HRreturnValue="CLOSED";
								break;
								case customizedValues.OPENING.toString() :
									returnValue=Characteristic.CurrentDoorState.OPENING; // 2
									HRreturnValue="OPENING";
								break;
								case customizedValues.CLOSING.toString() :
									returnValue=Characteristic.CurrentDoorState.CLOSING; // 3
									HRreturnValue="CLOSING";
								break;
								case customizedValues.STOPPED.toString() :
									returnValue=Characteristic.CurrentDoorState.STOPPED; // 4
									HRreturnValue="STOPPED";
								break;
						}
						if (DEV_DEBUG) {
							console.log(customizedValues);
							that.log('debug','Etat Garage/Barrier Homekit: '+returnValue+' soit en Jeedom:'+cmd.currentValue+" ("+HRreturnValue+")");
						}
						break;
					}
				}
			break;
			// Flaps & windowMoto
			case Characteristic.CurrentPosition.UUID :
			case Characteristic.TargetPosition.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_STATE' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						returnValue = Math.round(((returnValue-service.minValue) / (service.maxValue-service.minValue))*100);
						
						if(service.maxValue == 100) {
							returnValue = returnValue > (service.maxValue-5) ? service.maxValue : returnValue; // >95% is 100% in home (flaps need yearly tunning)
						}
						that.log('debug','---------update Blinds Value(refresh):',returnValue,'% soit',cmd.currentValue,' / ',service.maxValue);
						break;
					}
					if (cmd.generic_type == 'FLAP_STATE_CLOSING' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						returnValue = Math.round(((returnValue-service.minValue) / (service.maxValue-service.minValue))*100);
						if(service.maxValue == 100) {
							returnValue = returnValue > (service.maxValue-5) ? service.maxValue : returnValue; // >95% is 100% in home (flaps need yearly tunning)
						}
						returnValue = 100-returnValue; // invert percentage
						that.log('debug','---------update Inverted Blinds Value(refresh):',returnValue,'% soit',cmd.currentValue,' / ',service.maxValue);
						break;
					}
					if (cmd.generic_type == 'WINDOW_STATE' && cmd.id == service.cmd_id) {
						returnValue = parseInt(cmd.currentValue);
						returnValue = Math.round(((returnValue-service.minValue) / (service.maxValue-service.minValue))*100);

						that.log('debug','---------update WindowMoto Value(refresh):',returnValue,'% soit',cmd.currentValue,' / ',service.maxValue);
						break;
					}
				}
			break;
			case Characteristic.PositionState.UUID :
				returnValue = Characteristic.PositionState.STOPPED;
			break;
			case Characteristic.CurrentHorizontalTiltAngle.UUID :
			case Characteristic.TargetHorizontalTiltAngle.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_HOR_TILT_STATE') {
						returnValue = parseInt(cmd.currentValue);
						that.log('debug','---------update Blinds HorTilt Value(refresh):',returnValue);
						break;
					}
				}
			break;
			case Characteristic.CurrentVerticalTiltAngle.UUID :
			case Characteristic.TargetVerticalTiltAngle.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'FLAP_VER_TILT_STATE') {
						returnValue = parseInt(cmd.currentValue);
						that.log('debug','---------update Blinds VerTilt Value(refresh):',returnValue);
						break;
					}
				}
			break;
			// Locks
			case Characteristic.LockCurrentState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						service.target=cmd.currentValue;
						if(cmd.eqType == 'nuki' || (cmd.eqType == 'jeelink' && cmd.real_eqType && cmd.real_eqType == 'nuki')) {
							if (DEV_DEBUG) {that.log('debug','LockCurrentState (nuki) : ',cmd.currentValue);}
							switch(parseInt(cmd.currentValue)) {
								case 0 :
									returnValue=Characteristic.LockCurrentState.SECURED;
									break;
								case 1 :
									returnValue=Characteristic.LockCurrentState.UNSECURED;
									break;
								case 2 :
									returnValue=Characteristic.LockCurrentState.JAMMED;
									break;
								default : 
									returnValue=Characteristic.LockCurrentState.UNKNOWN;
									break;
							}
						// } else if(cmd.eqType == 'thekeys'  || (cmd.eqType == 'jeelink' && cmd.real_eqType && cmd.real_eqType == 'thekeys')) {
						//	if (DEV_DEBUG) that.log('debug','LockCurrentState (thekeys) : ',cmd.currentValue);
						//	returnValue = toBool(cmd.currentValue) === false ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
						} else {
							if (DEV_DEBUG) {that.log('debug','LockCurrentState : ',cmd.currentValue);}
							returnValue = toBool(cmd.currentValue) === true ? Characteristic.LockCurrentState.SECURED : Characteristic.LockCurrentState.UNSECURED;
						}
					}
				}
			break;
			case Characteristic.LockTargetState.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'LOCK_STATE') {
						let targetVal = cmd.currentValue;
						if(service.target !== undefined) {targetVal=service.target;}
						else {service.target=targetVal;}

						if(cmd.eqType == 'nuki' || (cmd.eqType == 'jeelink' && cmd.real_eqType && cmd.real_eqType == 'nuki')) {
							if (DEV_DEBUG) {that.log('debug','LockTargetState (nuki) : ',cmd.currentValue,'service.target : ',service.target);}
							returnValue = toBool(targetVal) === false ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
						// } else if(cmd.eqType == 'thekeys' || (cmd.eqType == 'jeelink' && cmd.real_eqType && cmd.real_eqType == 'thekeys')) {
						//	if (DEV_DEBUG) {that.log('debug','LockTargetState (thekeys) : ',cmd.currentValue);}
						//	returnValue = toBool(cmd.currentValue) === false ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
						} else {
							if (DEV_DEBUG) {that.log('debug','LockTargetState : ',cmd.currentValue,'service.target : ',service.target);}
							returnValue = toBool(targetVal) === true ? Characteristic.LockTargetState.SECURED : Characteristic.LockTargetState.UNSECURED;
						}
					}
				}
			break;
			// Speakers
			case Characteristic.Mute.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SPEAKER_MUTE' && cmd.id == service.cmd_id) {
						returnValue = toBool(cmd.currentValue);
						break;
					}
				}
				if(returnValue === 0) {
					// no mute status, just verify the volume, if 0 its muted
					for (const cmd of cmdList) {
						if ((cmd.generic_type == 'SPEAKER_VOLUME' || cmd.generic_type == 'VOLUME') && cmd.id == service.infos.volume.id) {
							if(cmd.currentValue == 0) {
								returnValue = true;
							} else {
								returnValue = false;
							}
							break;
						}
					}
				}
			break;
			case Characteristic.Volume.UUID :
				for (const cmd of cmdList) {
					if ((cmd.generic_type == 'SPEAKER_VOLUME' || cmd.generic_type == 'VOLUME') && cmd.id == service.infos.volume.id) {
						returnValue = cmd.currentValue;
						break;
					}
				}
			break;	
			// Battery
			case Characteristic.BatteryLevel.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == service.cmd_id) {
						if(cmd.currentValue==="") {
							returnValue=100; // Jeedom Cache not yet up to date
						} else {
							returnValue = cmd.currentValue;
						}
						break;
					}
				}
			break;
			case Characteristic.ChargingState.UUID :
				var hasFound = false;
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY_CHARGING' && cmd.id == service.infos.batteryCharging.id) {
						returnValue = cmd.currentValue;
						if(returnValue == 0) {
							returnValue = Characteristic.ChargingState.NOT_CHARGING;
						} else {
							returnValue = Characteristic.ChargingState.CHARGING;
						}
						hasFound = true;
						break;
					}
				}
				if(!hasFound) {returnValue = Characteristic.ChargingState.NOT_CHARGEABLE;}
			break;
			// Status
			case Characteristic.StatusLowBattery.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'BATTERY' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						if(cmd.currentValue==="" || returnValue > 20) {
							returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_NORMAL;
						} else {
							returnValue = Characteristic.StatusLowBattery.BATTERY_LEVEL_LOW;
						}
						break;
					}
				}
			break;
			case Characteristic.StatusTampered.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'SABOTAGE' && findMyID(service.statusArr,cmd.id) != -1) {
						const eqLogicSabotageInverted=service.sabotageInverted || 0;
						returnValue = eqLogicSabotageInverted==0 ? toBool(cmd.currentValue) : !toBool(cmd.currentValue); // invertBinary ?
						// returnValue = cmd.currentValue;
						if(cmd.currentValue!=="" && returnValue === false) {
							returnValue=Characteristic.StatusTampered.TAMPERED;
						} else {
							returnValue=Characteristic.StatusTampered.NOT_TAMPERED;
						}
						break;
					}
				}
			break;		
			case Characteristic.StatusFault.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'DEFECT' && findMyID(service.statusArr,cmd.id) != -1) {
						returnValue = toBool(cmd.currentValue);
						if(!returnValue) {
							returnValue = Characteristic.StatusFault.NO_FAULT;
						}else {
							returnValue = Characteristic.StatusFault.GENERAL_FAULT;
						}
						break;
					}
				}
			break;
			case Characteristic.StatusActive.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'ACTIVE' && findMyID(service.statusArr,cmd.id) != -1) {
						returnValue = toBool(cmd.currentValue);					
						break;
					}
				}
			break;
			// Consumption
			case Characteristic.CurrentPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'POWER' && cmd.id == service.cmd_id) {
						returnValue = cmd.currentValue;
						if(service.infos.power && service.infos.power.unite && service.infos.power.unite.toLowerCase() == 'kw') {
							returnValue = Math.round(cmd.currentValue*1000);
						}
						if(that.fakegato && service.eqLogic && service.eqLogic.hasLogging) {
							service.eqLogic.loggingService.addEntry({
								time: Math.round(new Date().valueOf() / 1000),
								power: returnValue,
							});
						}
						break;
					}
				}
			break;
			case Characteristic.TotalPowerConsumption.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'CONSUMPTION' && cmd.id == service.infos.consumption.id) {
						if(service.infos.consumption.unite && service.infos.consumption.unite.toLowerCase() == 'wh') {
							returnValue = Math.round(cmd.currentValue)/1000;
						} else {
							returnValue = cmd.currentValue;
						}
						break;
					}
				}
			break;
			// Used ?
			case Characteristic.TimeInterval.UUID :
				returnValue = Date.now();
				returnValue = parseInt(cmdList.timestamp) - returnValue;
				if (returnValue < 0) {returnValue = 0;}
			break;
			case Characteristic.ProgrammableSwitchEvent.UUID :
				if(service.type == 'Multi') {
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'SWITCH_STATELESS_ALLINONE' && cmd.id == service.infos.eventType.id) {
							const numButton = service.ServiceLabelIndex;
							const indexButton = numButton-1;
							
							let buttonSingle,buttonDouble,buttonLong;
					
							if(customizedValues.SINGLE) {
								buttonSingle = customizedValues.SINGLE.split(';');
							} else {
								buttonSingle = [""];
							}
							if(customizedValues.DOUBLE) {
								buttonDouble = customizedValues.DOUBLE.split(';');
							} else {
								buttonDouble = [""];
							}
							if(customizedValues.LONG) {
								buttonLong = customizedValues.LONG.split(';');
							} else {
								buttonLong = [""];
							}
							switch(cmd.currentValue.toString()) {
								case undefined:
									returnValue = undefined;
								break;
								case buttonSingle[indexButton].trim() :
									returnValue = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS; // 0
								break;
								case buttonDouble[indexButton].trim() :
									returnValue = Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS; // 1
								break;
								case buttonLong[indexButton].trim() :
									returnValue = Characteristic.ProgrammableSwitchEvent.LONG_PRESS; // 2
								break;
								default :
									returnValue = undefined;
								break;
							}
							break;
						}
					}
				} else if (service.type == 'Mono') {
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'SWITCH_STATELESS_SINGLE' && cmd.id == service.infos.Single.id) {
							returnValue = Characteristic.ProgrammableSwitchEvent.SINGLE_PRESS; // 0
							break;
						} else if (cmd.generic_type == 'SWITCH_STATELESS_DOUBLE' && cmd.id == service.infos.Double.id) {
							returnValue = Characteristic.ProgrammableSwitchEvent.DOUBLE_PRESS; // 1
							break;
						} else if (cmd.generic_type == 'SWITCH_STATELESS_LONG' && cmd.id == service.infos.Long.id) {
							returnValue = Characteristic.ProgrammableSwitchEvent.LONG_PRESS; // 2
							break;
						}
					}
				}
				that.log('debug','**********GetState ProgrammableSwitchEvent: '+returnValue);
			break;
			case Characteristic.OutletInUse.UUID :
				for (const cmd of cmdList) {
					if (cmd.generic_type == 'ENERGY_INUSE' && cmd.id == service.infos.inuse.id) {
						returnValue = toBool(cmd.currentValue);
						break;
					}
				}
				if(returnValue === 0) {
					for (const cmd of cmdList) {
						if (cmd.generic_type == 'POWER') {
							returnValue = parseFloat(cmd.currentValue) > 1.0 ? true : false;
							break;
						}
					}
				}
				if(returnValue === 0) {
					returnValue = false;
				}
			break;
		}
		// IF Online is 0 -> send no_response
		for (const cmd of cmdList) {
			if (cmd.generic_type == 'ONLINE') {
				if(parseInt(cmd.currentValue) === 0) {returnValue='no_response';}
				break;
			}
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
	if(!characteristic || !characteristic.props || !characteristic.props.format) {// just return the value if no characteristic
		return val;
	}
	
	switch(characteristic.props.format) {
			case Characteristic.Formats.UINT8 :
			case Characteristic.Formats.UINT16:
			case Characteristic.Formats.UINT32 :
			case Characteristic.Formats.UINT64 :
				val = parseInt(currentValue);
				val = Math.abs(val); // unsigned
				if(!val) {val = 0;}
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) {val = parseInt(characteristic.props.minValue);}
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) {val = parseInt(characteristic.props.maxValue);}		
			break;
			case Characteristic.Formats.INT :
				val = parseInt(currentValue);
				if(!val) {val = 0;}
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseInt(characteristic.props.minValue)) {val = parseInt(characteristic.props.minValue);}
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseInt(characteristic.props.maxValue)) {val = parseInt(characteristic.props.maxValue);}	
			break;
			case Characteristic.Formats.FLOAT :
				val = minStepRound(parseFloat(currentValue),characteristic);
				if(!val) {val = 0.0;}
				if(characteristic.props.minValue != null && characteristic.props.minValue != undefined && val < parseFloat(characteristic.props.minValue)) {val = parseFloat(characteristic.props.minValue);}
				if(characteristic.props.maxValue != null && characteristic.props.maxValue != undefined && val > parseFloat(characteristic.props.maxValue)) {val = parseFloat(characteristic.props.maxValue);}	
			break;
			case Characteristic.Formats.BOOL :
				val = toBool(currentValue);
				if(!val) {val = false;}
			break;
			case Characteristic.Formats.STRING :
			case Characteristic.Formats.TLV8 :
				if(currentValue !== undefined) {
					val = currentValue.toString();
				}
				if(!val) {val = '';}
			break;
			default :
				val = currentValue;
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
	if(characteristic.props.minStep == null || characteristic.props.minStep == undefined) {
		characteristic.props.minStep = 1;
	}
	const prec = (characteristic.props.minStep.toString().split('.')[1] || []).length;
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
// -- Return : nothing
JeedomPlatform.prototype.command = function(action, value, service) {
	try{
		const that = this;

		const cmdList = that.jeedomClient.getDeviceCmdFromCache(service.eqID); 
		
		var cmdId = service.cmd_id;
		let found=false;
		// ALARM
		var id_PRESENT,id_AWAY,id_NIGHT;
		if(action == 'SetAlarmMode') {
			if(service.alarm.present && service.alarm.present.mode_id != undefined) {
				id_PRESENT = service.alarm.present.mode_id;
			}
			if(service.alarm.away && service.alarm.away.mode_id != undefined) {
				id_AWAY = 	 service.alarm.away.mode_id;
			}
			if(service.alarm.night && service.alarm.night.mode_id != undefined) {
				id_NIGHT = 	 service.alarm.night.mode_id;
			}
		}
		// /ALARM	
		// THERMOSTAT
		var id_CHAUF,id_CLIM,id_OFF,id_CHAUF_HC,id_CLIM_HC,id_OFF_HC;
		if(action == 'TargetHeatingCoolingState') {
			if(service.thermo) {
				if(service.thermo.chauf && service.thermo.chauf.mode_id != undefined) {
					id_CHAUF = 	service.thermo.chauf.mode_id;
				}
				if(service.thermo.clim && service.thermo.clim.mode_id != undefined) {
					id_CLIM = 	service.thermo.clim.mode_id;
				}
				if(service.thermo.off && service.thermo.off.mode_id != undefined) {
					id_OFF = 	service.thermo.off.mode_id;
				}
			}
			if(service.thermoHC) {
				if(service.thermoHC.chauf && service.thermoHC.chauf.mode_id != undefined) {
					id_CHAUF_HC = 	service.thermoHC.chauf.mode_id;
				}
				if(service.thermoHC.clim && service.thermoHC.clim.mode_id != undefined) {
					id_CLIM_HC = 	service.thermoHC.clim.mode_id;
				}
				if(service.thermoHC.off && service.thermoHC.off.mode_id != undefined) {
					id_OFF_HC = 	service.thermoHC.off.mode_id;
				}
			}
		}		
		// /THERMOSTAT
		var needToTemporize=0;
		var needToTemporizeSec=0;
		var cmdFound;

		for (const cmd of cmdList) {
			if(!found) {
				switch (cmd.generic_type) {
					case 'MODE_SET_STATE' :
						if(action == 'modeSet' && service.actions[service.modeSwitch] && cmd.id == service.actions[service.modeSwitch].set_state.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						} else if(action == 'modeSetPrevious' && service.actions.set_state_previous && cmd.id == service.actions.set_state_previous.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FLAP_DOWN' :
						if(action == 'flapDown' && service.actions.down && cmd.id == service.actions.down.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FLAP_UP' :
						if(action == 'flapUp' && service.actions.up && cmd.id == service.actions.up.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'WINDOW_DOWN' :
						if(action == 'windowDown' && service.actions.down && cmd.id == service.actions.down.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'WINDOW_UP' :
						if(action == 'windowUp' && service.actions.up && cmd.id == service.actions.up.id) {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FLAP_SLIDER' :
						if(action != 'setValueHorTilt' && action != 'setValueVerTilt' && action != 'flapUp' && action != 'flapDown' && value >= 0 && service.actions.slider && cmd.id == service.actions.slider.id) {// should add action == 'setValue'
							cmdId = cmd.id;
							if (action == 'turnOn' && service.actions.down) {
								cmdId=service.actions.down.id;
							} else if (action == 'turnOff' && service.actions.up) {
								cmdId=service.actions.up.id;
							}								
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=500;
						}
					break;
					case 'FLAP_HOR_TILT_SLIDER' :
						if(action == 'setValueHorTilt' && service.actions.HorTiltSlider && cmd.id == service.actions.HorTiltSlider.id) {// should add action == 'setValue'
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=500;
						}
					break;
					case 'FLAP_VER_TILT_SLIDER' :
						if(action == 'setValueVerTilt' && service.actions.VerTiltSlider && cmd.id == service.actions.VerTiltSlider.id) {// should add action == 'setValue'
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=500;
						}
					break;					
					case 'WINDOW_SLIDER' :
						if(action != 'setValueHorTilt' && action != 'setValueVerTilt' && action != 'windowDown' && action != 'windowUp' && value >= 0 && service.actions.slider && cmd.id == service.actions.slider.id) {// should add action == 'setValue'
							cmdId = cmd.id;
							if (action == 'turnOn' && service.actions.down) {
								cmdId=service.actions.down.id;
							} else if (action == 'turnOff' && service.actions.up) {
								cmdId=service.actions.up.id;
							}		
							// brightness up to 100% in homekit, in Jeedom (Zwave) up to 99 max. Convert to Zwave						
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=500;
						}
					break;					
					case 'GB_OPEN' :
						if(action == 'GBopen') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'GB_CLOSE' :
						if(action == 'GBclose') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'GB_TOGGLE' :
						if(action == 'GBtoggle' || action == 'GBtoggleSelect') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FAUCET_ON' :
						if(action == 'turnOn') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'FAUCET_OFF' :
						if(action == 'turnOff') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'IRRIG_ON' :
						if(action == 'turnOn') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'IRRIG_OFF' :
						if(action == 'turnOff') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'VALVE_ON' :
						if(action == 'turnOn') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'VALVE_OFF' :
						if(action == 'turnOff') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LOCK_OPEN' :
						if(action == 'unsecure') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LOCK_CLOSE' :
						if(action == 'secure') {
							cmdId = cmd.id;
							found = true;
							cmdFound=cmd.generic_type;
						}
					break;
					case 'LIGHT_SLIDER' :
						if(action == 'setValueBright' && service.actions.slider && cmd.id == service.actions.slider.id) {
							this.log('debug',action+' : '+cmd.id);
							cmdId = cmd.id;	
							found = true;
							cmdFound=cmd.generic_type;
							if(!service.eqLogic.hasAdaptive) { needToTemporize=900; }
						}
					break;
					case 'FAN_SLIDER' :
					case 'FAN_SPEED' :
						if(action == 'setValue' && service.actions.slider && cmd.id == service.actions.slider.id) {
							cmdId = cmd.id;
							if (action == 'turnOn' && service.actions.on) {
								this.log('info','???????? should never go here ON');
								cmdId=service.actions.on.id;
							} else if (action == 'turnOff' && service.actions.off) {
								this.log('info','???????? should never go here OFF');
								cmdId=service.actions.off.id;
							}		
							found = true;
							cmdFound=cmd.generic_type;
							needToTemporize=900;
						}
					break;
					case 'SPEAKER_SET_VOLUME' :
					case 'SET_VOLUME' :
						if(service.actions.set_volume && cmd.id == service.actions.set_volume.id) {
							if(action == 'setValue') {
								cmdId = cmd.id;
								found = true;
								cmdFound=cmd.generic_type;
								needToTemporize=900;
							} else if(action == 'Mute' || action == 'Unmute') {
								if(service.actions.set_volume && cmd.id == service.actions.set_volume.id) {
									cmdId = cmd.id;
									cmdFound=cmd.generic_type;
									value = action == 'Mute' ? 0 : 10;
									found = true;
								}
							}
						}
					break;
					case 'SPEAKER_MUTE_TOGGLE' :
						if((action == 'Mute' || action == 'Unmute')) {
							if(service.actions.mute_toggle && cmd.id == service.actions.mute_toggle.id) {
								cmdId = cmd.id;
								cmdFound=cmd.generic_type;
								found = true;
							}
						}
					break;
					case 'SPEAKER_MUTE_ON' :
						if(action == 'Mute' && service.actions.mute_on && cmd.id == service.actions.mute_on.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'SPEAKER_MUTE_OFF' :
						if(action == 'Unmute' && service.actions.mute_off && cmd.id == service.actions.mute_off.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'LIGHT_ON' :
						if((action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;					
							cmdFound=cmd.generic_type;
							found = true;
							if(service.OnAfterBrightness) {needToTemporizeSec=20;}
						}
					break;
					case 'ENERGY_ON' :
						if((value == 255 || action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'FAN_ON' :
						if((value == 255 || action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'SWITCH_ON' :
					case 'CAMERA_RECORD' :
						if((value == 255 || action == 'turnOn') && service.actions.on && cmd.id == service.actions.on.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;			
					case 'GENERIC_ACTION' :
						if(cmd.subType == 'other' && action == 'Pushed' && service.actions.Push && cmd.id == service.actions.Push.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'PUSH_BUTTON' :
					case 'CAMERA_UP' :
					case 'CAMERA_DOWN' :
					case 'CAMERA_LEFT' :
					case 'CAMERA_RIGHT' :
					case 'CAMERA_ZOOM' :
					case 'CAMERA_DEZOOM' :
					case 'CAMERA_PRESET' :
						if(action == 'Pushed' && service.actions.Push && cmd.id == service.actions.Push.id) {
							cmdId = cmd.id;			
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'LIGHT_OFF' :
						if((action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;					
							cmdFound=cmd.generic_type;
							found = true;
							if(service.OnAfterBrightness) {needToTemporizeSec=20;}
						}
					break;
					case 'ENERGY_OFF' :
						if((value == 0 || action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;		
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'FAN_OFF' :
						if((value == 0 || action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;		
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'SWITCH_OFF' :
					case 'CAMERA_STOP' :
						if((value == 0 || action == 'turnOff') && service.actions.off && cmd.id == service.actions.off.id) {
							cmdId = cmd.id;		
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;					
					case 'THERMOSTAT_SET_LOCK' :
						if((action == 'turnOn') && service.actions.set_lock && cmd.id == service.actions.set_lock.id) {
							cmdId = cmd.id;				
							cmdFound=cmd.generic_type;							
							found = true;
						}
					break;
					case 'THERMOSTAT_SET_UNLOCK' :
						if((action == 'turnOff') && service.actions.set_unlock && cmd.id == service.actions.set_unlock.id) {
							cmdId = cmd.id;	
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'LIGHT_SET_COLOR' :
						if(action == 'setRGB' && service.actions.setcolor && cmd.id == service.actions.setcolor.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
							// needToTemporize=500;
						}
					break;
					case 'LIGHT_SET_COLOR_TEMP' :
						if(action == 'setValueTemp' && service.actions.setcolor_temp && cmd.id == service.actions.setcolor_temp.id) {
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
							needToTemporize=900;
						}
					break;
					case 'ALARM_RELEASED' :
						if(action == 'SetAlarmMode' && value == Characteristic.SecuritySystemTargetState.DISARM) {
							that.log('debug',"ALARM_RELEASED","setAlarmMode=",value,cmd.id);
							cmdId = cmd.id;
							cmdFound=cmd.generic_type;
							found = true;
						}
					break;
					case 'ALARM_SET_MODE' :
						if(action == 'SetAlarmMode' && service.hasAlarmModes) {
							that.log('debug',"ALARM_SET_MODE","SetAlarmMode=",action,value);
							cmdFound=cmd.generic_type;
							if(value == Characteristic.SecuritySystemTargetState.NIGHT_ARM && id_NIGHT != undefined) {
								cmdId = id_NIGHT;
								that.log('debug',"set nuit");
								found = true;
							} else if(value == Characteristic.SecuritySystemTargetState.AWAY_ARM && id_AWAY != undefined) {
								cmdId = id_AWAY;
								that.log('debug',"set absent");
								found = true;
							} else if(value == Characteristic.SecuritySystemTargetState.STAY_ARM && id_PRESENT != undefined) {
								cmdId = id_PRESENT;
								that.log('debug',"set present");
								found = true;
							}
						}
					break;
					case 'ALARM_ARMED' :
						if(action == 'SetAlarmMode' && value != Characteristic.SecuritySystemTargetState.DISARM && !service.hasAlarmModes) {
							that.log('debug',"ALARM_ARMED","SetAlarmMode=",action,cmd.id);
							cmdFound=cmd.generic_type;
							cmdId = cmd.id;
							found = true;
						}
					break;
					case 'THERMOSTAT_SET_SETPOINT' :
						if(action == 'setTargetLevel') {
							// if(value > 0) {
								cmdId = cmd.id;
								cmdFound=cmd.generic_type;
								found = true;
							// }
							needToTemporize=900;
						}
					break;
					case 'THERMOSTAT_HC_SET_SETPOINT_H' :
						if(action == 'setTargetLevelH') {
							if(value > 0) {
								cmdId = cmd.id;
								cmdFound=cmd.generic_type;
								found = true;
							}
							needToTemporize=900;
						}
					break;
					case 'THERMOSTAT_HC_SET_SETPOINT_C' :
						if(action == 'setTargetLevelC') {
							if(value > 0) {
								cmdId = cmd.id;
								cmdFound=cmd.generic_type;
								found = true;
							}
							needToTemporize=900;
						}
					break;
					case 'THERMOSTAT_SET_MODE' :
						if(action == 'TargetHeatingCoolingState') {
							if(value == Characteristic.TargetHeatingCoolingState.OFF && id_OFF != undefined) {
								cmdId = id_OFF;
								that.log('debug',"set OFF");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.HEAT && id_CHAUF != undefined) {
								cmdId = id_CHAUF;
								that.log('debug',"set CHAUF");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.COOL && id_CLIM != undefined) {
								cmdId = id_CLIM;
								that.log('debug',"set CLIM");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.AUTO) {
								cmdId = service.actions.set_setpoint.id;
								value = service.infos.setpoint.currentValue;
								that.log('debug','set AUTO',value);
								found = true;
							}
						}
					break;
					case 'THERMOSTAT_HC_SET_MODE' :
						if(action == 'TargetHeatingCoolingState') {
							if(value == Characteristic.TargetHeatingCoolingState.OFF && id_OFF != undefined) {
								cmdId = id_OFF_HC;
								that.log('debug',"set OFF");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.HEAT && id_CHAUF != undefined) {
								cmdId = id_CHAUF_HC;
								that.log('debug',"set CHAUF");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.COOL && id_CLIM != undefined) {
								cmdId = id_CLIM_HC;
								that.log('debug',"set CLIM");
								found = true;
							} else if(value == Characteristic.TargetHeatingCoolingState.AUTO) {
								cmdId = service.actions.set_setpointH.id;
								value = service.infos.setpointH.currentValue;
								that.log('debug','set AUTO',value);
								found = true;
							}
						}
					break;
				}
			}
		}
		
		if(needToTemporize===0 && needToTemporizeSec===0) {
			if(cmdFound=="LIGHT_ON") {
				if(that.settingLight) {
					if(service.ignoreOnCommandOnBrightnessChange) {
						return;
					}
				}
			}
			that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
				that.log('info','[Commande envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'generic:'+cmdFound,'response:'+JSON.stringify(response));
			}).catch(function(err) {
				that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err);
				if(err && err.stack) { console.error(err.stack); }
			});
		} else if(needToTemporize) {
			if(service.temporizator) {clearTimeout(service.temporizator);}
			service.temporizator = setTimeout(function(){
				if(cmdFound=="LIGHT_SLIDER") {that.settingLight=false;}
				if(cmdFound=="FAN_SLIDER" || cmdFound=="FAN_SPEED") {that.settingFan=false;}
				
				that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
					that.log('info','[Commande T envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
				}).catch(function(err) {
					that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err);
					if(err && err.stack) { console.error(err.stack); }
				});
			},needToTemporize);
		} else if(needToTemporizeSec) {
			if(service.temporizatorSec) {clearTimeout(service.temporizatorSec);}
			service.temporizatorSec = setTimeout(function(){
				if(cmdFound=="LIGHT_ON") {
					if(that.settingLight) {
						if(!service.ignoreOnCommandOnBrightnessChange) {
							// if(cmdFound=="LIGHT_ON" && service.infos && service.infos.state_bool && service.infos.state_bool.id) that.jeedomClient.updateModelInfo(service.infos.state_bool.id,true);
							setTimeout(function(){
								that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
									that.log('info','[Commande ON LATE envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
								}).catch(function(err) {
									that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err);
									if(err && err.stack) { console.error(err.stack); }
								});
							},1000);
						}
						return;
					}
				}
				
				that.jeedomClient.executeDeviceAction(cmdId, action, value).then(function(response) {
					that.log('info','[Commande T envoyée à Jeedom]','cmdId:' + cmdId,'action:' + action,'value: '+value,'response:'+JSON.stringify(response));
				}).catch(function(err) {
					that.log('error','Erreur à l\'envoi de la commande ' + action + ' vers ' + service.cmd_id , err);
					if(err && err.stack) { console.error(err.stack); }
				});
				
			},needToTemporizeSec);
		}
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
		if (characteristic.UUID == Characteristic.PositionState.UUID) {
			return;
		}
		this.updateSubscriptions.push({
			'service' : service,
			'characteristic' : characteristic,
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
	const that = this;
	if(that.pollingUpdateRunning) {return;}
	that.pollingUpdateRunning = true;
	that.jeedomClient.refreshStates().then(function(updates) {
		that.lastPoll = updates.datetime;
		if (updates.result) {
			updates.result.map(function(update) {
				if (update.name == 'cmd::update' && 
					update.option.value != undefined && 
					update.option.cmd_id) {
					
					if(that.jeedomClient.updateModelInfo(update.option.cmd_id,update.option.value)){ // Update cachedModel
						that.updateSubscribers(update);// Update subscribers
					}

				} else if(update.name == 'scenario::update' &&
					update.option.state != undefined && 
					update.option.scenario_id) {
					
					that.jeedomClient.updateModelScenario(update.option.scenario_id,update.option.state); // Update cachedModel
					that.updateSubscribers(update);// Update subscribers
					
				} else if(DEV_DEBUG && update.name == 'eqLogic::update' &&
					update.option.eqLogic_id) {
				
					const cacheState = that.jeedomClient.getDevicePropertiesFromCache(update.option.eqLogic_id);
					that.jeedomClient.getDeviceProperties(update.option.eqLogic_id).then(function(eqLogic){
						if(cacheState && eqLogic && cacheState.isEnable != eqLogic.isEnable) {
							that.log('debug',"Changing Enable in",update.option.eqLogic_id,'from',cacheState.isEnable,'to',eqLogic.isEnable);
							that.jeedomClient.updateModelEq(update.option.eqLogic_id,eqLogic);
						}
					});
					that.log('debug','[Reçu Type non géré]',update.name+' contenu: '+JSON.stringify(update).replace("\n",""));
				} else if(DEV_DEBUG) {
					that.log('debug','[Reçu Type non géré]',update.name+' ou contenu invalide: '+JSON.stringify(update).replace("\n",""));
				}
			});
		}
	}).then(function(){
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ /* that.log('debug','==RESTART POLLING=='); */that.startPollingUpdate(); }, that.pollerPeriod * 1000);
	}).catch(function(err) {
		that.log('error','Erreur de récupération des évènements de mise à jour: ', err);
		if(err && err.stack) { console.error(err.stack); }
		that.pollingUpdateRunning = false;
		that.pollingID = setTimeout(function(){ that.log('debug','!!RESTART POLLING AFTER ERROR!!');that.startPollingUpdate(); }, that.pollerPeriod * 2 * 1000);
	});
};

// -- updateSubscribers
// -- Desc : update subcribers populated by the subscribeUpdate method
// -- Params --
// -- update : the update received from Jeedom
// -- Return : nothing
JeedomPlatform.prototype.updateSubscribers = function(update) {
	const that = this;
	var subCharact,subService,updateID;
	for (let i = 0; i < that.updateSubscriptions.length; i++) {
		subCharact = that.updateSubscriptions[i].characteristic;
		subService = that.updateSubscriptions[i].service;

		if(update.option.scenario_id) {
			updateID = update.option.scenario_id;
		} else if(update.option.cmd_id) {
			updateID = update.option.cmd_id;
		}
		
		// that.log('debug',"update :",updateID,JSON.stringify(subService.infos),JSON.stringify(subService.statusArr),subCharact.UUID);
		const infoFound = findMyID(subService.infos,updateID);
		const statusFound = findMyID(subService.statusArr,updateID);
		if(infoFound != -1 || statusFound != -1) {
			let returnValue = that.getAccessoryValue(subCharact, subService, ((infoFound!=-1)?infoFound:statusFound));
			if(returnValue !== undefined && returnValue !== 'no_response') {
				returnValue = sanitizeValue(returnValue,subCharact);
				if(infoFound != -1 && infoFound.generic_type=="LIGHT_STATE") { // if it's a LIGHT_STATE
					if(!that.settingLight) { // and it's not currently being modified
						that.log('info','[Commande envoyée à HomeKit]','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+updateID+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+updateID+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);
						subCharact.updateValue(returnValue, undefined, 'fromJeedom');
					} else if(DEV_DEBUG) {that.log('debug','//Commande NON envoyée à HomeKit','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+updateID+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+updateID+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);}
				} else if(infoFound != -1 && (infoFound.generic_type=="FAN_STATE" || infoFound.generic_type=="FAN_SPEED_STATE")) { // if it's a FAN_STATE
					if(!that.settingFan) { // and it's not currently being modified
						that.log('info','[Commande envoyée à HomeKit]','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+updateID+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+updateID+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);
						subCharact.updateValue(returnValue, undefined, 'fromJeedom');
					} else if(DEV_DEBUG) {that.log('debug','//Commande NON envoyée à HomeKit','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+updateID+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+updateID+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);}
				} else {
					that.log('info','[Commande envoyée à HomeKit]','Cause de modif: "'+((infoFound && infoFound.name)?infoFound.name+'" ('+updateID+')':'')+((statusFound && statusFound.name)?statusFound.name+'" ('+updateID+')':''),"Envoi valeur:",returnValue,'dans',subCharact.displayName);
					subCharact.updateValue(returnValue, undefined, 'fromJeedom');
				}
			} else if (returnValue === 'no_response') {
				subCharact.updateValue(new Error('no_response'), undefined, 'fromJeedom');
			} else { return; }
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
	if (h != null) {
		service.HSBValue.hue = h;
	}
	if (s != null) {
		service.HSBValue.saturation = s;
	}
	if (v != null) {
		service.HSBValue.brightness = v;
	}
	const rgb = HSVtoRGB(service.HSBValue.hue, service.HSBValue.saturation, service.HSBValue.brightness);
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
	if (!color) {
		color = '0,0,0';
	}
	// this.log('debug',"couleur :" + color);
	// var colors = color.split(',');
	const r = hexToR(color);
	const g = hexToG(color);
	const b = hexToB(color);
	service.RGBValue.red = r;
	service.RGBValue.green = g;
	service.RGBValue.blue = b;
	const hsv = RGBtoHSV(r, g, b);
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
// -- Return : nothing
JeedomPlatform.prototype.syncColorCharacteristics = function(rgb, service) {
	/* switch (--service.countColorCharacteristics) {
	case -1:
		service.countColorCharacteristics = 2; */
		const that = this;

		clearTimeout(service.timeoutIdColorCharacteristics);
		service.timeoutIdColorCharacteristics = setTimeout(function() {
			// if (service.countColorCharacteristics < 2)
			//	return;
			const rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
			if (DEV_DEBUG) {that.log('debug',"---------setRGB : ",rgbColor);}
			that.command('setRGB', rgbColor, service);
			// service.countColorCharacteristics = 0;
			// service.timeoutIdColorCharacteristics = 0;
		}, 500);
		/* break;
	case 0:
		var rgbColor = rgbToHex(rgb.r, rgb.g, rgb.b);
		this.command('setRGB', rgbColor, service);
		service.countColorCharacteristics = 0;
		service.timeoutIdColorCharacteristics = 0;
		break;
	default:
		break;
	} */
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
			perms : [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.TimeInterval, Characteristic);
	Characteristic.TimeInterval.UUID = '2A6529B5-5825-4AF3-AD52-20288FBDA115';

	Characteristic.CurrentPowerConsumption = function() {
		Characteristic.call(this, 'Consumption', 'E863F10D-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.UINT16,
			unit : 'Watts',
			maxValue : 100000,
			minValue : -100000,
			minStep : 1,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.CurrentPowerConsumption, Characteristic);
	Characteristic.CurrentPowerConsumption.UUID = 'E863F10D-079E-48FF-8F27-9C2605A29F52';

	Characteristic.TotalPowerConsumption = function() {
		Characteristic.call(this, 'Total Consumption', 'E863F10C-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format : Characteristic.Formats.FLOAT, // Deviation from Eve Energy observed type
			unit : 'kWh',
			maxValue : 100000000000,
			minValue : 0,
			minStep : 0.001,
			perms : [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
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
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
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
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	inherits(Characteristic.AirPressure, Characteristic);	
	Characteristic.AirPressure.UUID = 'E863F10F-079E-48FF-8F27-9C2605A29F52';

	// contacts helpers, need to identify
	Characteristic.TimesOpened = function() {
		Characteristic.call(this, 'TimesOpened', 'E863F129-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT32,
			perms: [ Characteristic.Perms.WRITE, Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.TimesOpened.UUID = 'E863F129-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.TimesOpened, Characteristic);
	
	Characteristic.Char118 = function() {
		Characteristic.call(this, 'Char118', 'E863F118-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT32,
			perms: [ Characteristic.Perms.WRITE, Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Char118.UUID = 'E863F118-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.Char118, Characteristic);
	
	Characteristic.Char119 = function() {
		Characteristic.call(this, 'Char119', 'E863F119-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT32,
			perms: [ Characteristic.Perms.WRITE, Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Char119.UUID = 'E863F119-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.Char119, Characteristic);
	
	Characteristic.LastActivation = function() {
		Characteristic.call(this, 'LastActivation', 'E863F11A-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT32,
			perms: [ Characteristic.Perms.WRITE, Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.LastActivation.UUID = 'E863F11A-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.LastActivation, Characteristic);	
	
	Characteristic.ResetTotal = function() {
		Characteristic.call(this, 'ResetTotal', 'E863F112-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT32,
			perms: [ Characteristic.Perms.WRITE, Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.ResetTotal.UUID = 'E863F112-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.ResetTotal, Characteristic);	
	// / contacts helpers
	
	// Motion Helpers
	Characteristic.Sensitivity = function() {
		Characteristic.call(this, 'Sensitivity', 'E863F120-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			maxValue: 7,
			minValue: 0,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Sensitivity.UUID = 'E863F120-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.Sensitivity, Characteristic);

	Characteristic.Duration = function() {
		Characteristic.call(this, 'Duration', 'E863F12D-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			maxValue: 3600,
			minValue: 0,
			minStep: 1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Duration.UUID = 'E863F12D-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.Duration, Characteristic);
	// /Motion Helpers
	
	
	
	Characteristic.GenericINT = function() {
		Characteristic.call(this, 'ValueINT', '2ACF6D35-4FBF-4688-8787-6D5C4BA3A263');
		this.setProps({
			format: Characteristic.Formats.INT,
			minStep: 1,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericINT.UUID = '2ACF6D35-4FBF-4688-8787-6D5C4BA3A263';
	inherits(Characteristic.GenericINT, Characteristic);	
	
	Characteristic.GenericFLOAT = function() {
		Characteristic.call(this, 'ValueFLOAT', '0168A695-70A7-4AF7-A800-417D30055719');
		this.setProps({
			format: Characteristic.Formats.FLOAT,
			minStep: 0.01,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericFLOAT.UUID = '0168A695-70A7-4AF7-A800-417D30055719';
	inherits(Characteristic.GenericFLOAT, Characteristic);		
	
	Characteristic.GenericBOOL = function() {
		Characteristic.call(this, 'ValueBOOL', 'D8E3301A-CD20-4AAB-8F70-F80789E6ADCB');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericBOOL.UUID = 'D8E3301A-CD20-4AAB-8F70-F80789E6ADCB';
	inherits(Characteristic.GenericBOOL, Characteristic);	

	Characteristic.GenericSTRING = function() {
		Characteristic.call(this, 'ValueSTRING', 'EB19CE11-01F4-47DD-B7DA-B81C0640A5C1');
		this.setProps({
			format: Characteristic.Formats.STRING,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.GenericSTRING.UUID = 'EB19CE11-01F4-47DD-B7DA-B81C0640A5C1';
	inherits(Characteristic.GenericSTRING, Characteristic);		
	
	Characteristic.AQI = function() {
		Characteristic.call(this, 'Index', '2ACF6D35-4FBF-4689-8787-6D5C4BA3A263');
		this.setProps({
			format: Characteristic.Formats.INT,
			unit: '',
			minStep: 1,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.AQI.UUID = '2ACF6D35-4FBF-4689-8787-6D5C4BA3A263';
	inherits(Characteristic.AQI, Characteristic);	

	Characteristic.PPM = function() {
		Characteristic.call(this, 'PPM', 'E863F10B-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.UINT16,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.HIDDEN],
		});
		this.value = this.getDefaultValue();
    };
	Characteristic.PPM.UUID = 'E863F10B-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.PPM, Characteristic);	

    Characteristic.AQExtraCharacteristic = function() {
		Characteristic.call(this, 'AQX2', 'E863F132-079E-48FF-8F27-9C2605A29F52');
		this.setProps({
			format: Characteristic.Formats.DATA,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.HIDDEN],
		});
        this.value = this.getDefaultValue();
	};	
	Characteristic.AQExtraCharacteristic.UUID = 'E863F132-079E-48FF-8F27-9C2605A29F52';
	inherits(Characteristic.AQExtraCharacteristic, Characteristic);	
	
	Characteristic.WindSpeed = function() {
		Characteristic.call(this, 'Wind speed', '49C8AE5A-A3A5-41AB-BF1F-12D5654F9F41');
		this.setProps({
			format: Characteristic.Formats.FLOAT,
			unit: "km/h",
			maxValue: 100,
			minValue: 0,
			minStep: 0.1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.WindSpeed.UUID = '49C8AE5A-A3A5-41AB-BF1F-12D5654F9F41';
	inherits(Characteristic.WindSpeed, Characteristic);

	Characteristic.WindDirection = function() {
		Characteristic.call(this, 'Wind direction', '46f1284c-1912-421b-82f5-eb75008b167e');
		this.setProps({
			format: Characteristic.Formats.STRING,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.WindDirection.UUID = '46f1284c-1912-421b-82f5-eb75008b167e';
	inherits(Characteristic.WindDirection, Characteristic);

	Characteristic.WeatherCondition = function() {
		Characteristic.call(this, 'Condition', 'cd65a9ab-85ad-494a-b2bd-2f380084134d');
		this.setProps({
			format: Characteristic.Formats.STRING,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.WeatherCondition.UUID = 'cd65a9ab-85ad-494a-b2bd-2f380084134d';
	inherits(Characteristic.WeatherCondition, Characteristic);

	Characteristic.Visibility = function() {
			Characteristic.call(this, 'Visibility', 'd24ecc1e-6fad-4fb5-8137-5af88bd5e857');
			this.setProps({
				format: Characteristic.Formats.UINT8,
				unit: "km",
				maxValue: 200,
				minValue: 0,
				minStep: 1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		};
	Characteristic.Visibility.UUID = 'd24ecc1e-6fad-4fb5-8137-5af88bd5e857';
	inherits(Characteristic.Visibility, Characteristic);
	
	Characteristic.Rain = function() {
		Characteristic.call(this, 'Rain', 'F14EB1AD-E000-4EF4-A54F-0CF07B2E7BE7');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Rain.UUID = 'F14EB1AD-E000-4EF4-A54F-0CF07B2E7BE7';
	inherits(Characteristic.Rain, Characteristic);
	
	Characteristic.Snow = function() {
		Characteristic.call(this, 'Snow', 'F14EB1AD-E000-4CE6-BD0E-384F9EC4D5DD');
		this.setProps({
			format: Characteristic.Formats.BOOL,
			perms: [ Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.Snow.UUID = 'F14EB1AD-E000-4CE6-BD0E-384F9EC4D5DD';
	inherits(Characteristic.Snow, Characteristic);
	
	Characteristic.MinimumTemperature = function() {
		Characteristic.call(this, 'MinimumTemperature', '707B78CA-51AB-4DC9-8630-80A58F07E419');
		this.setProps({
			format: Characteristic.Formats.FLOAT,
			unit: Characteristic.Units.CELSIUS,
			maxValue: 100,
			minValue: -40,
			minStep: 0.1,
			perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
		});
		this.value = this.getDefaultValue();
	};
	Characteristic.MinimumTemperature.UUID = '707B78CA-51AB-4DC9-8630-80A58F07E419';
	inherits(Characteristic.MinimumTemperature, Characteristic);
	
	Characteristic.NoiseLevel = function() {
			Characteristic.call(this, 'Noise Level', 'b3bbfabc-d78c-5b8d-948c-5dac1ee2cde5');
			this.setProps({
				format: Characteristic.Formats.UINT8,
				unit: "dB",
				maxValue: 1000,
				minValue: 0,
				minStep: 1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		};
	Characteristic.NoiseLevel.UUID = 'b3bbfabc-d78c-5b8d-948c-5dac1ee2cde5';
	inherits(Characteristic.NoiseLevel, Characteristic);
	
	Characteristic.NoiseQuality = function() {
			Characteristic.call(this, 'Noise Quality', '627ea399-29d9-5dc8-9a02-08ae928f73d8');
			this.setProps({
				format: Characteristic.Formats.UINT8,
				maxValue: 5,
				minValue: 0,
				minStep: 1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		};
	Characteristic.NoiseQuality.UUID = '627ea399-29d9-5dc8-9a02-08ae928f73d8';
	inherits(Characteristic.NoiseQuality, Characteristic);
	
	Characteristic.NoiseQuality.UNKNOWN = 0;
	Characteristic.NoiseQuality.SILENT = 1;
	Characteristic.NoiseQuality.CALM = 2;
	Characteristic.NoiseQuality.LIGHTLYNOISY = 3;
	Characteristic.NoiseQuality.NOISY = 4;
	Characteristic.NoiseQuality.TOONOISY = 5;
	
	
	Characteristic.SetDuration = function() {
			Characteristic.call(this, 'Set Duration', '000000D3-0000-1000-8000-0026BB765291');
			this.setProps({
				format: Characteristic.Formats.UINT32,
				maxValue: 3600,
				minValue: 0,
				minStep: 1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.WRITE, Characteristic.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		};
	Characteristic.SetDuration.UUID = '000000D3-0000-1000-8000-0026BB765291';
	inherits(Characteristic.SetDuration, Characteristic);
	
	Characteristic.RemainingDuration = function() {
			Characteristic.call(this, 'Remaining Duration', '000000D4-0000-1000-8000-0026BB765291');
			this.setProps({
				format: Characteristic.Formats.UINT32,
				maxValue: 3600,
				minValue: 0,
				minStep: 1,
				perms: [Characteristic.Perms.READ, Characteristic.Perms.NOTIFY],
			});
			this.value = this.getDefaultValue();
		};
	Characteristic.RemainingDuration.UUID = '000000D4-0000-1000-8000-0026BB765291';
	inherits(Characteristic.RemainingDuration, Characteristic);
	
	/**
	 * FakeGato History Service
	 */
	// Service.FakeGatoHistoryService=FakeGatoHistoryService;
	// inherits(Service.FakeGatoHistoryService, Service);
	
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
	 * Custom Service 'Pressure Sensor'
	 */

	Service.PressureSensor = function(displayName, subtype) {
		Service.call(this, displayName, 'E863F00A-079E-48FF-8F27-9C2605A29F52', subtype);

		// Required Characteristics
		this.addCharacteristic(Characteristic.AirPressure);

		// Optional Characteristics

	};
	inherits(Service.PressureSensor, Service);
	Service.PressureSensor.UUID = 'E863F00A-079E-48FF-8F27-9C2605A29F52';
	
	/**
	 * Custom Service 'Noise Sensor'
	 */

	Service.NoiseSensor = function(displayName, subtype) {
		Service.call(this, displayName, '6237cefc-9f4d-54b2-8033-2eda0053b811', subtype);

		// Required Characteristics
		this.addCharacteristic(Characteristic.NoiseLevel);
		this.addCharacteristic(Characteristic.NoiseQuality);
		// Optional Characteristics

	};
	inherits(Service.NoiseSensor, Service);
	Service.NoiseSensor.UUID = '6237cefc-9f4d-54b2-8033-2eda0053b811';

	/**
	 * Custom Service 'Weather Service'
	 */

	Service.WeatherService = function(displayName, subtype) {
		Service.call(this, displayName, 'E863F001-079E-48FF-8F27-9C2605A29F52', subtype);

		// Required Characteristics
		// this.addCharacteristic(Characteristic.CurrentTemperature);
		// this.addCharacteristic(Characteristic.CurrentRelativeHumidity);
		// this.addCharacteristic(Characteristic.AirPressure);
		this.addCharacteristic(Characteristic.WeatherCondition);

		// Optional Characteristics
		this.addOptionalCharacteristic(Characteristic.WindDirection);
		this.addOptionalCharacteristic(Characteristic.WindSpeed);
		// this.addOptionalCharacteristic(Characteristic.WeatherCondition);
		this.addOptionalCharacteristic(Characteristic.UVIndex);
		this.addOptionalCharacteristic(Characteristic.Rain);
		this.addOptionalCharacteristic(Characteristic.Snow);
		this.addOptionalCharacteristic(Characteristic.MinimumTemperature);
	};
	inherits(Service.WeatherService, Service);
	Service.WeatherService.UUID = 'E863F001-079E-48FF-8F27-9C2605A29F52';	
	
	/**
	 * Custom Service 'EveRoom Service'
	 */

	Service.EveRoomService = function(displayName, subtype) {
		Service.call(this, displayName, '0000008D-0000-1000-8000-0026BB765291', subtype);

		// Required Characteristics
		// this.addCharacteristic(Characteristic.CurrentTemperature);
		// this.addCharacteristic(Characteristic.CurrentRelativeHumidity);
		// this.addCharacteristic(Characteristic.AirPressure);
		this.addCharacteristic(Characteristic.AirQuality);

		// Optional Characteristics
		// this.addOptionalCharacteristic(Characteristic.WeatherCondition);

	};
	inherits(Service.EveRoomService, Service);
	Service.EveRoomService.UUID = '0000008D-0000-1000-8000-0026BB765291';	
	
	/**
	 * Custom Service 'Custom Service'
	 */

	Service.CustomService = function(displayName, subtype) {
		Service.call(this, displayName, 'BF0477D3-699A-42F1-BF98-04FCCFE5C8E7', subtype);

		this.addOptionalCharacteristic(Characteristic.Name);
	};
	inherits(Service.CustomService, Service);	
	Service.CustomService.UUID = 'BF0477D3-699A-42F1-BF98-04FCCFE5C8E7';
	
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
				this.log('debug',' Ajout service :'+service.controlService.displayName+' subtype:'+service.controlService.subtype+' cmd_id:'+service.controlService.cmd_id+' UUID:'+service.controlService.UUID);
				newAccessory.addService(service.controlService);
				for (var i = 0; i < service.characteristics.length; i++) {
					characteristic = service.controlService.getCharacteristic(service.characteristics[i]);
					
					cachedValue = cachedValues[service.controlService.subtype+characteristic.displayName];
					if(cachedValue != undefined && cachedValue != null){
						characteristic.updateValue(sanitizeValue(cachedValue,characteristic), undefined, 'fromCache');
					}
					
					characteristic.props.needsBinding = true;
					if (characteristic.UUID && characteristic.UUID == Characteristic.CurrentAmbientLightLevel.UUID) {
						characteristic.props.minValue = 0;
					}
					if (characteristic.UUID && characteristic.UUID == Characteristic.CurrentTemperature.UUID) {
						characteristic.props.maxValue = 300;
						characteristic.props.minValue = -50;
						characteristic.props.minStep = 0.01;
					}
					this.platform.bindCharacteristicEvents(characteristic, service.controlService);
					this.log('debug','    Caractéristique :'+characteristic.displayName+' valeur initiale:'+characteristic.value);
				}
			} else {
				this.log('debug','On essaye d\'ajouter un service mais il existe déjà : ',service.controlService);
			}
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
		const serviceList=[];
		const cachedValues=[];
		for(var t=0; t< accessory.services.length;t++) { 
			if(accessory.services[t].UUID != Service.AccessoryInformation.UUID && 
				accessory.services[t].UUID != Service.BridgingState.UUID) {
				serviceList.push(accessory.services[t]);
			}
		}		
		for(service of serviceList){ // dont work in one loop or with temp object :(
			this.log('debug',' Suppression service :'+service.displayName+' subtype:'+service.subtype+' UUID:'+service.UUID);
			for (const c of service.characteristics) {
				this.log('debug','    Caractéristique :'+c.displayName+' valeur cache:'+c.value);
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
	if (isNaN(n)) {
		return '00';
	}
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
function HSVtoRGB(hue, saturation, _value) {
	let h = hue / 360.0;
	let s = saturation / 100.0;
	let v = 1.0;
	let r, g, b;
	if (arguments.length === 1) {
		s = h.s;
		v = 1.0;
		h = h.h;
	}
	const i = Math.floor(h * 6);
	const f = h * 6 - i;
	const p = v * (1 - s);
	const q = v * (1 - f * s);
	const t = v * (1 - (1 - f) * s);
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
		b : Math.round(b * 255),
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
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h;
	const s = (max === 0 ? 0 : d / max);
	const v = max / 255;

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
		v : v * 100.0,
	};
}

// -- findMyID
// -- Desc : search an id in an object
// -- Params --
// -- id : id to find
// -- Return : Object found
function findMyID(obj,id) {
	for(const o in obj) {
        // if( obj.hasOwnProperty( o ) && obj[o] && obj[o].id && parseInt(obj[o].id) && parseInt(id) && parseInt(obj[o].id)==parseInt(id)) {
        if( obj.hasOwnProperty( o ) && obj[o] && obj[o].id && obj[o].id==id) {
			return obj[o];
        }
    }
	return -1;
}
