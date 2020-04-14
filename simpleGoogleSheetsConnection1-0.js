//<script src="simpleGoogleSheetsConnection.js"></script>
//<script src="serialize-0.2.min.js"></script>

function GoogleConnection(url){
    this.url=url;
    this.response="";
    this.http = new XMLHttpRequest();
    this.execute = function(sheet,action,lvaluepairs,lconditions,lvalue,fdone) {
        var str = "columns="+JSON.stringify(lvalue)+"&";
        str += "query=" + JSON.stringify(lconditions)+"&";
        str += this.querystring(lvaluepairs);
        this.send("sheet="+sheet+"&action="+action+"&"+str,fdone);
    } 
    this.readValuePairs = function(sheet,lconditions,lvalue,fdone) {
        var str = "columns="+JSON.stringify(lvalue)+"&";
        str += "query=" + JSON.stringify(lconditions);
        //alert(str);
        this.send("sheet="+sheet+"&action=read&"+str,fdone);      
    }
    this.writeValuePairs = function(sheet,lvaluepairs,lconditions,fdone) {
        var str = this.querystring(lvaluepairs)+"&";
        str += "query=" + JSON.stringify(lconditions);
        this.send("sheet="+sheet+"&action=write&"+str,fdone);
    }
    this.writeForm = function (sheet,strformid,fdone) { 
        var str = serialize(document.getElementById(strformid));
        this.send("sheet="+sheet+"&action=write&"+str,fdone);
    }
    this.deleteValuePairs = function(sheet,lconditions,fdone) {
        var str = "query=" + JSON.stringify(lconditions);
        //alert(str);
        this.send("sheet="+sheet+"&action=delete&"+str,fdone);      
    }
    this.send = function (strSerializedlist,fdone) {
        this.http.open("POST", this.url+"?"+strSerializedlist, true);
        //alert(strSerializedlist);
        this.http.setRequestHeader("Content-type","application/x-www-form-urlencoded");
        this.http.send(null);
        this.http.onload = fdone;
    }
    this.querystring = function (lvaluepairs) {
        return Object.keys(lvaluepairs).map((key) => {
            return encodeURIComponent(key) + '=' + encodeURIComponent(lvaluepairs[key])
        }).join('&');
    }
    this.convertDateISO = function (date) {
        // date as string dd/mm/yyyy
        return new Date(date).toISOString().substring(0,10);
    }
} 

/*readValuePairs
writeValuePairs
addColumn
removeColumn/

/*  

            <form id="test">
                <input type='text' id='1' name='user'  value='kak1'>
                <input type='text' id='2' name='tense' value='kak2'>
                <input type='text' id='3' name='verb' value='kak3'>
            </form>

var screen = new simpleHTML("screen");

var pushAngles = new GoogleConnection("https://script.google.com/macros/s/AKfycbxDyKbQsSyaVsLhGQr54gkzLKNobMEKAHu8OfKINEkISHrfImg/exec");

screen.prnt("start");
pushAngles.sendValuePairs({user:"Guillemix",result:false},function(){
    alert(pushAngles.http.responseText);
});

pushAngles.sendForm("test",function(){
    alert(pushAngles.http.responseText);
});
screen.prnt("done");


// Només com a funció
function sendGoogleSheets(lvaluepairs,url) {
    var http = new XMLHttpRequest();
    var str = "?";

    var k = Object.keys(lvaluepairs);
    for (var i in k) {
        str+= k[i] + "=" +lvaluepairs[k[i]]+"&";
    }
    http.open("GET", url+str, true);
    http.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    http.send(null);
    http.onload = function() {
        alert(http.responseText);
    }
}

function formSubmit(formid) {
    var http = new XMLHttpRequest();
    var params = serialize(document.getElementById(formid));
    http.open("GET", "https://script.google.com/macros/s/AKfycbxDyKbQsSyaVsLhGQr54gkzLKNobMEKAHu8OfKINEkISHrfImg/exec"+"?"+params, true);
    http.setRequestHeader("Content-type","application/x-www-form-urlencoded");
    http.send(null);
    http.onload = function() {
        alert(http.responseText);
    }
}

sendGoogleSheets({user:"Guillemix",result:false},"https://script.google.com/macros/s/AKfycbxDyKbQsSyaVsLhGQr54gkzLKNobMEKAHu8OfKINEkISHrfImg/exec")
*/