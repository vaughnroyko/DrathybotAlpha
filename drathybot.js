var irc = require('twitch-irc');
var chalk = require('chalk');
var request = require('request'); //Load http to get chatters/viewers (not apart of Twitch API)

var clientOptions = {
    options: {
        debug: true,
        debugIgnore: ['ping', 'chat', 'join', 'part'],
        tc: 1
    },
    identity: {
        username: 'drathybot',
        password: 'oauth:'
    },
    channels: ['drathy']
}

var client = new irc.client(clientOptions);
var api = require('twitch-irc-api');
var mongoose = require('mongoose');

//Init DB
mongoose.connect('mongodb://localhost/drathybot', function(err) {
	if (err) {
        console.log(chalk.red(err));
	} else {
		console.log('Connection to MongoDB successful.');
	}
});

//User DB
var usersSchema = mongoose.Schema({
	username: String,
    points: Number,
	time: Number,
    items: [Number],
    firstjoin: Date
});

var UsersDB = mongoose.model('users', usersSchema);

//Quote DB
var quoteSchema = mongoose.Schema({
	quote: String,
    username: String,
    added: Date
});

var QuoteDB = mongoose.model('quotes', quoteSchema);

client.connect();

//Point and time ticker, every minute
var users = {};
var userType = {
    Moderator: 1,
    Viewer: 2,
    New: 3
}

setInterval(function() {
    getViewers();
    getAPIData();

    //Add points/time
    for(var i in users) {
        //TODO fix, doesn't work?
        UsersDB.update({username: i}, { $inc: { points: 1, time: 1 } });
    }

}, 60000);

var apiData = {};

function getAPIData() {
    api.call({
        channel: 'drathy',
        method: 'GET',
        path: '/streams/drathy',
        options: {}
    }, function(err, statusCode, response) {
        if (err) {
            console.log(chalk.red(err));
            return;
        }
        apiData = response;
    });
}

getAPIData();

function getViewers() {
    //Get chatters/viewers
    request('https://tmi.twitch.tv/group/user/drathy/chatters', function (error, response, body) {
        if (!error && response.statusCode == 200) {
            var response = JSON.parse(body);
            var chatters = response.chatters;
            var newUsers = {};
            for(var i = 0; i < chatters.viewers.length; i++) {
                newUsers[chatters.viewers[i]] = userType.Viewer;
            }
            for(var i = 0; i < chatters.moderators.length; i++) {
                newUsers[chatters.moderators[i]] = userType.Moderator;
            }

            //Get new joiners
            for(var i in newUsers) {
                if (!users[i]) {
                    //New join
                    users[i] = newUsers[i];
                    console.log(chalk.cyan.bold(i + ' has joined!'));

                    //Check if the user exists
                    (function(i){ //Fix async
                        UsersDB.findOne({username: i}, function(err, docs) {
                            if (docs) {
                                console.log(chalk.green.bold(i + ' has ' + docs.points + ' points!'));
                            } else {
                                var now = new Date();
                                var newUser = new UsersDB({username: i, points: 5, time: 0, items: [], firstjoin: now});
                                newUser.save(function(err, result) {
                                    console.log(chalk.green.bold('Gave ' + i + ' 5 points for joining for the first time.'));
                                });
                            }
                        });
                    })(i);
                }
            }

            //Get new parters
            for(var i in users) {
                if (!newUsers[i]) {
                    console.log(chalk.grey.bold(i + ' has left!'));
                    delete users[i];
                }
            }
        }
    });
}

function isMod(username) {
    return users[username] === userType.Moderator;
}

getViewers();

//Chat listener
client.addListener('chat', function (channel, user, message) {

    var messageLogged = false;

    //Hello alerts
    var salutations = [
        "hello",
        "hi",
        "hiya",
        "sup",
        "greetings",
        "yo",
        "saluations",
        "hey",
        "hai"
    ];

    for(var i = 0; i < salutations.length; i++) {
        if (message.toLowerCase().search('\\b' + salutations[i] + '\\b') > -1) {
            console.log(chalk.bold.magenta.underline(user.username + ": " + message));
            messageLogged = true;
            //TODO Growl notification
            //https://github.com/tj/node-growl
            //https://github.com/azer/play-audio
            //http://www.paralint.com/projects/notifu/
        }
    }

    //Bye alerts
    var farewells = [
        "ciao",
        "bye",
        "farewell",
        "goodbye",
        "toodles",
        "adios",
        "sayonara",
        "later"
    ];

    for(var i = 0; i < farewells.length; i++) {
        if (message.toLowerCase().search('\\b' + farewells[i] + '\\b') > -1) {
            console.log(chalk.bold.magenta.underline(user.username + ": " + message));
            messageLogged = true;
            //TODO Growl notification
        }
    }

    //Top 10
    if (message.toLowerCase() === '!top10') {
        //TODO fix
        /*
        var output = "Top 10: ";
        UsersDB.find().sort({points: -1}).limit(10).toArray().map(function(doc) {
            output += doc.username + ": " + doc.points + " | ";
        });
        output = output.substring(0, output.length - 3);
        client.say(channel, output);
        */
    }

    //Balance
    if (message.toLowerCase() === '!balance') {
        UsersDB.findOne({username: user.username}, function(err, docs) {
            if (docs) {
                client.say(channel, 'You have ' + docs.points + ' points ' + user.username + '!');
            }
        });
    }

    //Stop the bot
    if (message.toLowerCase() === '!stop') {
        //Mods and myself can stop the bot
        if (user.username === 'drathy' || isMod(user.username)) {
            client.say(channel, '#REKT');
            console.log(chalk.red(user.username + ' stopped the bot!'));
            client.disconnect(); //Stop IRC
            process.exit(); //Stop node
        }
    }

    //Uptime
    if (message.toLowerCase() === '!uptime') {
        var started = new Date(apiData.stream.created_at);
        var now = new Date();
        var uptime = now - started;
        var hours = Math.floor((uptime % 86400000) / 3600000);
        var minutes = Math.floor(((uptime % 86400000) % 3600000) / 60000);
        client.say(channel, 'Drathy has been streaming for ' + hours + ' hours and ' + minutes + ' minutes!');
    }

    //Adding a quote to the quoteDB
    //!quote <user> <message>
    if (message.toLowerCase().indexOf('!quote') === 0) {
        var params = message.split(' ');
        var quoteUser = params[1].toLowerCase();
        var quoteMsg = params.slice(2).join(' ');
        // Do something
        UsersDB.findOne({username: user.username, time: { $gt: 100 }}, function(err, docs) {
            //Only allow people with certain time, or me, or mode to add quotes
            if (docs || user.username === 'drathy' ||  isMod(user.username)) {
                UsersDB.findOne({username: quoteUser}, function(err, docs) {
                    if (docs) {
                        var now = new Date();
                        //TODO doesn't work?
                        QuoteDB.insert({username: quoteUser, quote: quoteMsg, added: now});
                        client.say(channel, 'Quote has been added for ' + quoteUser + '!');
                    } else {
                        client.say(channel, quoteUser + ' does not exist!');
                    }
                });
            }
        });
    }

    //Display quotes
    if (message.toLowerCase().indexOf('!recite') === 0) {
        //TODO fix, map/toArray not working - we shouldn't need array/map here
        var rand = Math.floor(Math.random() * QuoteDB.count());
        QuoteDB.find().limit(-1).skip(rand).next().toArray().map(function(doc) {
            client.say(channel, doc.username + ': ' + doc.quote);
        });
    }

    //If we haven't sent a message, log a normal one
    if (!messageLogged) {
        console.log(chalk.white(user.username + ": " + message));
    }

});
