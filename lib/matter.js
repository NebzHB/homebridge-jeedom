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
/* jshint esversion: 11,node: true */
'use strict';

// -- JeedomMatter
// -- Desc : Builds/reads/writes Matter accessories on behalf of a JeedomPlatform instance.
// --        One get/set/push trio per Matter cluster type; buildXAccessory() assembles the descriptor.
// -- Params --
// -- Plateform : the JeedomPlatform instance (.command, .getAccessoryValue, .api, .rooms, .config, .log)
// -- toBool : boolean coercion helper from index.js
function JeedomMatter(Plateform, toBool) {
	this.Plateform = Plateform;
	this.toBool = toBool;
}

// -- buildOnOffAccessory
// -- Desc : Build a Matter on/off (outlet) accessory descriptor, reusing the same Serv used by HomeKit
// -- Params --
// -- eqLogic : the jeedom eqLogic
// -- Serv : the HomeKit controlService already built for this device (energy or Switch block)
// -- displayName : name to give to the Matter accessory
// -- Return : the Matter accessory descriptor
JeedomMatter.prototype.buildOnOffAccessory = function(eqLogic, Serv, displayName) {
	const Plateform = this.Plateform;
	const uuid = Plateform.api.hap.uuid.generate('matter-' + Serv.subtype);
	Serv.matterUUID = uuid;
	return {
		UUID: uuid,
		displayName: displayName,
		manufacturer: Plateform.rooms[eqLogic.object_id] +'>'+eqLogic.origName+((eqLogic.pseudo)?' ('+displayName+')':''),
		model: ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name),
		serialNumber: '<'+eqLogic.id+(eqLogic.logicalId && typeof eqLogic.logicalId === 'string' ? '-'+eqLogic.logicalId.replace(/\//g,'\\') : '')+'-'+Plateform.config.name+'>',
		context: {},
		deviceType: Plateform.api.matter.deviceTypes.OnOffOutlet,
		clusters: {onOff: {onOff: this.getOnOffState(Serv)}},
		handlers: {
			onOff: {
				on: () => {this.setOnOffState(Serv, true);},
				off: () => {this.setOnOffState(Serv, false);},
				toggle: () => {this.setOnOffState(Serv, !this.getOnOffState(Serv));},
			},
		},
	};
};

// -- getOnOffState
// -- Desc : Read the current on/off boolean state of a service, as seen by Jeedom
JeedomMatter.prototype.getOnOffState = function(Serv) {
	return this.toBool(this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.On.UUID}, Serv));
};

// -- setOnOffState
// -- Desc : Send an on/off command to Jeedom on behalf of a Matter controller
JeedomMatter.prototype.setOnOffState = function(Serv, value) {
	this.Plateform.command(value ? 'turnOn' : 'turnOff', null, Serv);
};

// -- pushOnOffState
// -- Desc : Push a state change coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
// -- value : already-sanitized boolean, reused as-is (avoids a 2nd getAccessoryValue call and its fakegato side effect)
JeedomMatter.prototype.pushOnOffState = function(Serv, value) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'onOff', {onOff: value}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter onOff :',err);
	});
};

// -- registerAccessories
// -- Desc : Register newly built Matter accessories with Homebridge, isolating Matter errors from the HAP error path
// -- Params --
// -- matterAccessories : array of Matter accessory descriptors built by buildOnOffAccessory (or future siblings)
JeedomMatter.prototype.registerAccessories = function(matterAccessories) {
	try{
		this.Plateform.api.matter.registerPlatformAccessories('homebridge-jeedom', 'Jeedom', matterAccessories).catch((err) => {
			this.Plateform.log('error','Erreur de l\'enregistrement d\'accessoire(s) Matter :',err);
		});
	}
	catch(e){
		this.Plateform.log('error','Erreur de la fonction registerAccessories :',e);
		console.error(e.stack);
	}
};

module.exports.createHelper = function(Plateform, toBool) {
	return new JeedomMatter(Plateform, toBool);
};
