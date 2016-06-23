//Jeedom rest api client

'use strict';

var request = require("request");

function JeedomClient(ip, port, complement, apikey) {
	this.apikey = apikey;
	this.url = "http://"+ip+":"+port+""+complement+"/core/api/jeeApi.php";
}
JeedomClient.prototype.getRooms = function() {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"object::all","params":{"apikey":"'+that.apikey+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200)
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.getDevices = function() {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"eqLogic::all","params":{"apikey":"'+that.apikey+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.getDeviceProperties = function(ID) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	    var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"eqLogic::byId","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json.properties);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.executeDeviceAction = function(ID, action, param) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
		var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"cmd::execCmd","params":{"apikey":"'+that.apikey+'","id":"'+ID+'"}}'
		  }
		}, function(err, response) {
      		if (!err && (response.statusCode == 200 || response.statusCode == 202)) 
        		resolve(response);
        	else
        		reject(err, response);
        });
	});
	return p;
}
JeedomClient.prototype.refreshStates = function(lastPoll) {
	var that = this;
	var p = new Promise(function(resolve, reject) {
	  	var url = that.url;
	  		request.post(url, {json: true,
		form: {
		    request: '{"jsonrpc":"2.0","method":"event::changes","params":{"apikey":"'+that.apikey+'","datetime" : "'+lastPoll+'"}}'
		  }
		}, function(err, response, json) {
      		if (!err && response.statusCode == 200) 
        		resolve(json);
        	else
        		reject(err, response);
        });
	});
	return p;
}

module.exports.createClient = function(ip, port, complement, apikey) {
	return new JeedomClient(ip, port, complement, apikey);
}
