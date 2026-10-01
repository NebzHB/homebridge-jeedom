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

// -- truncate32
// -- Desc : Matter's Basic Information string fields (vendorName, productName, serialNumber, nodeLabel) are capped at 32 chars by spec; longer values make the whole accessory fail to initialize
function truncate32(str) {
	return (typeof str === 'string' && str.length > 32) ? str.slice(0, 32) : str;
}

// -- buildManufacturer
// -- Desc : Build the Matter vendorName; always keep the room, drop the pseudo suffix before resorting to a hard truncate
function buildManufacturer(room, origName, pseudo, displayName) {
	const full = room + '>' + origName + (pseudo ? ' (' + displayName + ')' : '');
	if (full.length <= 32) {return full;}
	return truncate32(room + '>' + origName);
}

// -- buildSerialNumber
// -- Desc : Build the Matter serialNumber; always keep the id and config name (unique/disambiguating), drop the logicalId before resorting to a hard truncate
function buildSerialNumber(id, logicalId, configName) {
	const withLogicalId = '<'+id+(logicalId && typeof logicalId === 'string' ? '-'+logicalId.replace(/\//g,'\\') : '')+'-'+configName+'>';
	if (withLogicalId.length <= 32) {return withLogicalId;}
	return truncate32('<'+id+'-'+configName+'>');
}

// -- JeedomMatter
// -- Desc : Builds/reads/writes Matter accessories on behalf of a JeedomPlatform instance.
// --        One get/set/push trio per Matter cluster type; buildXAccessory() assembles the descriptor.
// -- Params --
// -- Plateform : the JeedomPlatform instance (.command, .getAccessoryValue, .api, .rooms, .config, .log)
function JeedomMatter(Plateform) {
	this.Plateform = Plateform;
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
	Serv.matterDisplayName = displayName;
	const clusters = {onOff: {onOff: this.getOnOffState(Serv)}};
	const powerValue = this.getPowerState(Serv);
	if (powerValue !== null) {clusters.electricalPowerMeasurement = {activePower: powerValue};}
	const energyValue = this.getEnergyState(Serv);
	if (energyValue !== null) {clusters.electricalEnergyMeasurement = {cumulativeEnergyImported: {energy: energyValue}};}
	return {
		UUID: uuid,
		displayName: truncate32(displayName),
		manufacturer: buildManufacturer(Plateform.rooms[eqLogic.object_id], eqLogic.origName, eqLogic.pseudo, displayName),
		model: ((eqLogic.eqType_name == "jeelink" && eqLogic.real_eqType) ? eqLogic.eqType_name+':'+eqLogic.real_eqType : eqLogic.eqType_name),
		serialNumber: buildSerialNumber(eqLogic.id, eqLogic.logicalId, Plateform.config.name),
		context: {},
		deviceType: Plateform.api.matter.deviceTypes.OnOffOutlet,
		clusters: clusters,
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
	return toBool(this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.On.UUID}, Serv));
};

// -- getPowerState
// -- Desc : Read the current instantaneous power of a service, in milliwatts (Matter unit), or null if no power sensor
JeedomMatter.prototype.getPowerState = function(Serv) {
	if (!Serv.infos.power) {return null;}
	const watts = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.CurrentPowerConsumption.UUID}, Serv);
	return (typeof watts === 'number') ? Math.round(watts * 1000) : null;
};

// -- getEnergyState
// -- Desc : Read the current cumulative energy of a service, in milliwatt-hours (Matter unit), or null if no consumption sensor
JeedomMatter.prototype.getEnergyState = function(Serv) {
	if (!Serv.infos.consumption) {return null;}
	const kWh = this.Plateform.getAccessoryValue({UUID: this.Plateform.api.hap.Characteristic.TotalPowerConsumption.UUID}, Serv);
	return (typeof kWh === 'number') ? Math.round(Math.max(kWh, 0) * 1000000) : null;
};

// -- setOnOffState
// -- Desc : Send an on/off command to Jeedom on behalf of a Matter controller
JeedomMatter.prototype.setOnOffState = function(Serv, value) {
	this.Plateform.log('info','[Commande de Matter]','Nom:'+Serv.matterDisplayName+'('+Serv.matterUUID+'):'+value);
	this.Plateform.command(value ? 'turnOn' : 'turnOff', null, Serv);
};

// -- pushOnOffState
// -- Desc : Push a state change coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
// -- value : already-sanitized boolean, reused as-is (avoids a 2nd getAccessoryValue call and its fakegato side effect)
// -- logMessage : shared "cause" text also logged for the HomeKit push; destination name is appended per-destination
JeedomMatter.prototype.pushOnOffState = function(Serv, value, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'onOff', {onOff: value}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter onOff :',err);
	});
};

// -- pushPowerState
// -- Desc : Push an instantaneous power change (Watts) coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
JeedomMatter.prototype.pushPowerState = function(Serv, watts, logMessage) {
	if (!Serv.matterUUID) {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'electricalPowerMeasurement', {activePower: Math.round(watts * 1000)}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter electricalPowerMeasurement :',err);
	});
};

// -- pushEnergyState
// -- Desc : Push a cumulative energy change (kWh) coming from Jeedom to the Matter controller; no-op if Serv isn't a Matter accessory
JeedomMatter.prototype.pushEnergyState = function(Serv, kWh, logMessage) {
	if (!Serv.matterUUID || typeof kWh !== 'number') {return;}
	this.Plateform.log('info','[Commande envoyée à Matter]',logMessage+' dans '+Serv.matterDisplayName);
	this.Plateform.api.matter.updateAccessoryState(Serv.matterUUID, 'electricalEnergyMeasurement', {cumulativeEnergyImported: {energy: Math.round(Math.max(kWh, 0) * 1000000)}}).catch((err) => {
		this.Plateform.log('error','Erreur de MAJ Matter electricalEnergyMeasurement :',err);
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

module.exports.createHelper = function(Plateform) {
	return new JeedomMatter(Plateform);
};
