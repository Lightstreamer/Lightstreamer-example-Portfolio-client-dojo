/*
Copyright (c) Lightstreamer Srl

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

require([
  "js/lsClient", "lightstreamer-store/LightstreamerStore",
  "dojox/charting/Chart", "dojox/charting/axis2d/Default", "dojox/charting/plot2d/Default",
  "dojox/charting/themes/Claro", "dojox/charting/StoreSeries",
  "dijit/layout/BorderContainer", "dijit/Dialog", "dijit/form/ToggleButton", "dijit/registry",
  "dijit/form/Button", "dijit/form/NumberTextBox", "dijit/form/CurrencyTextBox", "dojo/number",
  "dijit/form/NumberSpinner", "dijit/form/FilteringSelect",
  "dgrid","dgrid/editor", "dojo/_base/lang", "dojo/store/Memory", "dojo/store/Observable", "dojo/parser",
  "dijit/TitlePane", "dojo/_base/array", "dojo/domReady!"
], function(lsClient, LightstreamerStore, Chart, axis2dDefault, plot2dDefault, Claro,
  StoreSeries, BorderContainer, Dialog, ToggleButton, registry, Button, NumberTextBox, CurrencyTextBox, 
  dojoNumber, NumberSpinner, FilteringSelect, Grid, editor, lang, Memory, Observable, parser, TitlePane, arrayUtil){

  //  Formatters for various parts of the UI
  formatters = {
    //  CHART FORMATTERS
    time: function(value){
      var tmp = new Date(Number(value.replace(/,/g,"")));
      return ("0" + tmp.getHours()).slice(-2) 
        + ":" 
        + ("0" + tmp.getMinutes()).slice(-2) 
        + ":" 
        + ("0" + tmp.getSeconds()).slice(-2);
    }
  };

  //  functions to cast from one type to another.  Used in the chart.
  converters = {
    time: function(time){
      //  convert the given time format (HH:MM:SS) to a real date object.
      var tmp = time.split(":"), now = new Date();
      var ret = new Date(
        now.getFullYear(), 
        now.getMonth(), 
        now.getDate(), 
        parseInt(tmp[0], 10), 
        parseInt(tmp[1], 10), 
        parseInt(tmp[2], 10), 
        0
      );
      return ret;
    }
  };
  

  handlers = {
    reCheckSumma: function(id, time) { 
      var summa = 0;
      fullPortfolio.forEach(function(o) {
        if (o["ctv"]) {
          summa+=Number(o["ctv"]);
        }
      });
      portfolioSumma.setValue(dojoNumber.format(summa.toFixed(2), {pattern: "#,##0.00"}));

      //new point in chart
      var prev = chartStore.get(prgChart);
      var updateMs = new Date().getTime();
      
      while (updateMs > highTime) { 
        handlers.configureXAxis(prev ? lowTime+(LIMIT/2) : updateMs);
      }
      
      //normalize value
      var updateSumma = parseFloat(summa);
      var normalizedSumma = !prev  ? 100 : updateSumma/prev.summa*100;
      
      chartStore.put({ y: normalizedSumma, x: updateMs, summa: updateSumma, id: ++prgChart});
    },
    
    configureXAxis: function(startTime) {
      //configure the X
      lowTime = startTime;
      highTime = lowTime + LIMIT;
      
      chart.addAxis("x", lang.mixin(lang.clone(config.xAxis), titleInfo, { min: lowTime, max: highTime, from: lowTime, to: highTime}));
      
      //delete "obsolete" points
      var remIfLowerThan = lowTime-1000;
      var toRem = chartStore.query(function(obj){
        return obj.x < remIfLowerThan;
      });
      
      toRem.forEach(function(obj) {
        chartStore.remove(obj.id);
      });
    
    },
    
    fillOrdersTable: function(prog, status) { 
      obj = ordersMemory.get(prog);
      obj.status = status;
      ordersMemory.put(obj, {id: prog});
      ordGrid.refresh();
    },
    
    sendOrder: function(type,stockId,qty) {
      var prog = ++prgs;
      ordersMemory.put({order:type,prog:prog,quantity:qty,stock_name:selStore.get(stockId).name,status:"SUBMITTING"},{id: prog});
      ordGrid.refresh();
      var mex = type+"|" + config.portfolioId + "|" + stockId + "|" + qty;
      lsClient.sendMessage(mex, "Orders", 30000, {
        onAbort: function(originalMex, snt) {
          handlers.fillOrdersTable(prog, "ABORT");
        },
        onDeny: function(originalMex, code, nbr) {
          handlers.fillOrdersTable(prog, "DENY");
        },
        onDiscarded: function(originalMex) {
          handlers.fillOrdersTable(prog, "DISCARDED");
        },
        onError: function(originalMex) {
          handlers.fillOrdersTable(prog, "ERROR");
        },
        onProcessed: function(originalMex) {
          handlers.fillOrdersTable(prog, "PROCESSED");
        } 
      });
  
    },
    
    sndOrderBuy: function() {
      if ( inputQty.state == "Warning" || inputQty.state == "Error" || sel.value == "") {
        alert("Order not valid! Please check order quantity or stock name.");
      } else {
        handlers.sendOrder("BUY",sel.value,inputQty.value);
      }
    },
  
    sndOrderSell: function() {
      if ( inputQty.state == "Warning" || inputQty.state == "Error" || sel.value == "") {
        alert("Order not valid! Please check order quantity or stock name.");
      } else {
        handlers.sendOrder("SELL",sel.value,inputQty.value);
      }
    },

    toggle: function(value) {
      //  generic function designed to make the toggle
      var id = this.id;
      if(!value){
        //  we want to prevent something being turned off, so block it here.
        this._onChangeActive = false;
        this.set("checked", true);
        this._onChangeActive = true;
        return;
      }

      //  ok, we checked this one, so let's make sure the others are unchecked.
      arrayUtil.forEach(config.plotButtons, function(b){
        if("button" + b == id) { 
          return; 
        }
        var button = dijit.byId("button" + b);
        if(button){
          button._onChangeActive = false;
          button.set("checked", false);
          button._onChangeActive = true;
        }
      });

      //  now that the UI is done, switch the chart plot and go.
      var plot = {type: "Default", lines: true, markers: true, tension: "X" };
      switch(this.id){
        case "buttonCurvedArea":{
          plot.areas = true;
          break;
        }
        case "buttonStraightLines":{
          delete plot.tension;
          break;
        }
        case "buttonLinesOnly": {
          plot.markers = false;
          break;
        }
      }

      // ugly trick follows. Any alternative?
      
      //remove chartSeries
      for (var i in chartSeries) { 
        chart.removeSeries(chartSeries[i].id);
      }
      //switch plot
      chart.removePlot("default");
      chart.addPlot("default", plot);
      //add back chart series
      for (var i in chartSeries) { 
        chart.addSeries(chartSeries[i].id, new dojox.charting.StoreSeries(chartSeries[i].store, {},   { x: "x", y: "y" }), fixedThemes[chartSeries[i].id-1]);
      }
      //repaint
      chart.render();
      
    }
  };

  //  BEGIN APPLICATION ------------------------------------------------------------
  var prgs = 0;
  var config = {
    portfolioId: "portfolio1",
    fieldsList: ["key", "command", "qty"],
    columns: [  
                //editor({ label: "Show", field: "show", sortable: false }, "checkbox"),
                editor({ label: "Buy", field: "buy", editorArgs: {iconClass:"plusIcon", showLabel:false, btnId: 3343 } }, Button),
                editor({ label: "Sell", field: "sell", editorArgs: {iconClass:"minusIcon", showLabel:false, btnId: 0 } }, Button),
                editor({ label: "Order", field: "order", sortable: false,  autoSave: true, editorArgs: {value: 0, constraints: { min:0, max:1000550, places:0 }, style: "width:9em"} }, NumberSpinner),
                { id: "name", label: "Name", field: "stock_name", sortable: true },
                { id: "last", label: "Last", field: "last_price", sortable: true },
                { id: "qty", label: "Qty", field: "qty", sortable: true },
                { id: "ctv", label: "Counter Value", field: "ctv" },
                { id: "time", label: "Time", field: "time", sortable: true },
                { id: "id", label: "id", field: "id", sortable: false, visible: false }
              ],
    orderColumns: [
                { id: "prog", label: "prog", field: "prog", sortable: true },
                { id: "stock", label: "Name", field: "stock_name", sortable: true },
                { id: "order", label: "Order", field: "order", sortable: true },
                { id: "qty", label: "Quantity", field: "quantity" },
                { id: "status", label: "Status", field: "status", sortable: true }
              ],
    xAxis: { 
      title: "Time", 
      fixLower: "major", 
      fixUpper: "minor", 
      natural: true, 
      labelFunc: formatters.time,  
      majorLabels: true, majorTicks: true, majorTick: {length:10}, majorTickStep:5000,
      minorLabels: false, minorTicks:true, minorTick:{length:6},  minorTickStep:1000
    },
    plotButtons: [ "CurvedLines", "StraightLines", "LinesOnly" ]
  };

  //  extra info for the chart
  var titleInfo = {
    titleFont: "Verdana",
    titleFontColor: "#636656",
    titleOrientation: "away",
    titleGap: 3
  };
  
  //set up a store to match item with stock
  var selStore = new Memory({
        data: [
            {name:"Anduct", id:"item1"},
            {name:"Ations Europe", id:"item2"},
            {name:"Bagies Consulting", id:"item3"},
            {name:"BAY Corporation", id:"item4"},
            {name:"CON Consulting", id:"item5"},
            {name:"Corcor PLC", id:"item6"},
            {name:"CVS Asia", id:"item7"},
            {name:"Datio PLC", id:"item8"},
            {name:"Dentems", id:"item9"},
            {name:"ELE Manufacturing", id:"item10"},
            {name:"Exacktum Systems", id:"item11"},
            {name:"KLA Systems Inc", id:"item12"},
            {name:"Lted Europe", id:"item13"},
            {name:"Magasconall Capital", id:"item14"},
            {name:"MED", id:"item15"},
            {name:"Mice Investments", id:"item16"},
            {name:"Micropline PLC", id:"item17"},
            {name:"Nologicroup Devices", id:"item18"},
            {name:"Phing Technology", id:"item19"},
            {name:"Pres Partners", id:"item20"},
            {name:"Quips Devices", id:"item21"},
            {name:"Ress Devices", id:"item22"},
            {name:"Sacle Research", id:"item23"},
            {name:"Seaging Devices", id:"item24"},
            {name:"Sems Systems, Inc", id:"item25"},
            {name:"Softwora Consulting", id:"item26"},
            {name:"Systeria Develop", id:"item27"},
            {name:"Thewlec Asia", id:"item28"},
            {name:"Virtutis", id:"item29"},
            {name:"Yahl", id:"item30"}
      ]
  });
  
  //  remove the stroke around the chart itself.
  Claro.chart.stroke = null;

  
  // let dojo parse the html
  parser.parse();
  
  
  
//HERE starts the interesting stuff  

// initiate the LightstreamerStore
  var portfolioStore = new LightstreamerStore(lsClient, {
    items: [config.portfolioId], 
    fields: config.fieldsList,
    mode: "COMMAND",
    dataAdapter: "PORTFOLIO_ADAPTER", 
    commandSecondLevelDataAdapter: "QUOTE_ADAPTER",
    commandSecondLevelFields: ["stock_name", "last_price", "time"]
    //requestedMaxFrequency: 0.5
  });  
  
  
// initiate stock select
  var sel = new FilteringSelect({
                name: "stockSelect",
                value: "",
                placeHolder: "Select a Stock ... ",
                store: selStore,
                searchAttr: "name",
            }, "stockSelect");
  sel.startup();  
  
  
// create the grid
  var grid = new Grid({
      columns:  config.columns,
      region: 'center',
      height: 'auto',
      updateDelay: 0,
      });
 
  grid.styleColumn(0, "width: 3em; height: 2em; text-align: center; border-width: 0px;");
  grid.styleColumn(1, "width: 3em; height: 2em; text-align: center; border-width: 0px;");
  grid.styleColumn(2, "width: 10em; height: 2em; text-align: center; border-width: 0px;");
  grid.styleColumn("last", "width: 9em; text-align: right; padding: 2px; border-width: 0px;");
  grid.styleColumn("qty", "width: 9em; text-align: right; padding: 2px; border-width: 0px;");
  grid.styleColumn("time", "width: 9em; text-align: right; padding: 2px; border-width: 0px;");
  grid.styleColumn("ctv", "width: 12em; text-align: right; padding: 2px; border-width: 0px;");
  grid.styleColumn("name", "width: auto; text-align: left; padding-left: 2px; border-width: 0px;");
  grid.styleColumn("id", "display:none");

  grid.on(".dgrid-cell:click", function(evt){
    var cell = grid.cell(evt);
    if (cell.column) {
      if (cell.column.id == 1 || cell.column.id == 0) {
        if (!cell.row.data["order"] || cell.row.data["order"] <= 0 ) {
          //alert("Order not valid! Please check order quantity");
        } else {
          handlers.sendOrder(cell.column.id == 0 ? "BUY" : "SELL",cell.row.data["id"],cell.row.data["order"]);
        }
      } else if (cell.column.id == 2) {
        //we should find a way to trigger the dgrid-datachange otherwise an update on the "clicking" stock will erase the value we're writing
      }
    }
  });
  
  grid.on("dgrid-datachange", function(evt){  
    // when the show checkbox is flagged/unflagged we need to update the store by saving the dirt data of the grid
    var cell = evt.cell;
    if ( cell.column && cell.column.id == 2 ) {
      setTimeout(function() {
        grid.save();
      },0);
    }
  });
    
  // bind the grid with the store
  grid.set("store",portfolioStore);
  registry.byId("grid").set("content", grid);
  
  //start sorting by stock_name
  grid.set("sort","stock_name"); 
  
  var fullPortfolio = portfolioStore.query();
  fullPortfolio.observe(function(object){
    if (object["qty"] && object["last_price"]) {
      var newCtv = (object["qty"]*object["last_price"]).toFixed(2);
      if (newCtv != object["ctv"]) {
        object["ctv"] = newCtv;
        portfolioStore.put(object);
        handlers.reCheckSumma(object["id"], object["time"]);
      }
    }
  });

  
//  create the orders grid
  var ordGrid = new Grid({
      columns:  config.orderColumns,
      region: 'center',
      height: 'auto',
      queryOptions: {start:0, count:500},
      updateDelay: 10});
  
  ordGrid.styleColumn("prog", "width: 3em; text-align: left; padding: 2px; border-width: 0px;");
  ordGrid.styleColumn("stock", "width: 9em; text-align: left; padding: 2px; border-width: 0px;");
  ordGrid.styleColumn("order", "width: 4em; text-align: center; padding: 2px; border-width: 0px;");
  ordGrid.styleColumn("qty", "width: 5em; text-align: right; padding: 2px; border-width: 0px;");
  ordGrid.styleColumn("status", "width: 7em; text-align: left; padding-left: 2px; border-width: 0px;");
  
  var ordersMemory = new Memory(); 
  ordGrid.setStore(new Observable(ordersMemory));
  registry.byId("orderGrid").set("content", ordGrid);
        
  ordGrid.startup();  
  
  
  
// initiate the chart

  var LIMIT = 30000;
  var lowTime = 0, highTime = 0;
  var prgChart = 0;
  var chartStore = Observable(new Memory({}));

  var chart = new Chart("chartArea").
  setTheme(Claro).
  addAxis("y", {vertical: true, fixLower: "minor", fixUpper: "minor", includeZero: false, min: 90, max: 110 }).
  addPlot("default", {type: "Default", lines: true, markers: true, tension: "X" }).
  addSeries("summa", new StoreSeries(chartStore, {},   { x: "x", y: "y" })).
  render();

  
  //set up the chart resize
  var cp = registry.byId("chartArea");
  cp.on("resize", function(){
    chart.resize();
  });
  

  var portfolioSumma = registry.byId("PortfolioSumma");
  var inputQty = registry.byId("orderQty");
  
  var btnBuy = registry.byId("buttonBuy");
  btnBuy.on("click", lang.hitch(handlers, "sndOrderBuy"));
  
  var btnSell = registry.byId("buttonSell");
  btnSell.on("click", lang.hitch(handlers, "sndOrderSell"));
});