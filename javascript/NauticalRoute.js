/******************************************************************************
 Copyright 2011 Olaf Hannemann

 This file is free software: you can redistribute it and/or modify
 it under the terms of the GNU General Public License as published by
 the Free Software Foundation, either version 3 of the License, or
 (at your option) any later version.

 This file is distributed in the hope that it will be useful,
 but WITHOUT ANY WARRANTY; without even the implied warranty of
 MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 GNU General Public License for more details.

 You should have received a copy of the GNU General Public License
 along with this file.  If not, see <http://www.gnu.org/licenses/>.
 ******************************************************************************

 ******************************************************************************
 This file implements the nautical route service to the OpenSeaMap map.
 Version 0.1.1  15.10.2011
 ******************************************************************************/

// var defaultStyle = {strokeColor: "blue", strokeOpacity: "0.8", strokeWidth: 3, fillColor: "blue", pointRadius: 3, cursor: "pointer"};
// var style = OpenLayers.Util.applyDefaults(defaultStyle, OpenLayers.Feature.Vector.style["default"]);
// var routeStyle = new OpenLayers.StyleMap({
//     'default': style,
//     'select': {strokeColor: "red", fillColor: "red"}
// });

var editPanel;
var routeDraw;
var routeEdit;

var routeTrack;
let previousPoints = [];
var routeObject;

var style_edit = {
  strokeColor: "#CD3333",
  strokeWidth: 3,
  pointRadius: 4,
};
const modifyStyle = new ol.style.Style({
  image: new ol.style.Circle({
    radius: 3,
    fill: new ol.style.Fill({
      color: "blue",
    }),
    stroke: new ol.style.Stroke({
      width: 3,
      color: "rgba(0,0,255,0.8)",
    }),
  }),
  stroke: new ol.style.Stroke({
    width: 3,
    color: "red",
  }),
  geometry: (feature) => {
    const line = feature.getGeometry();
    const multipoint = new ol.geom.MultiPoint(line.getCoordinates());
    const geomColl = new ol.geom.GeometryCollection([line, multipoint]);
    return geomColl;
  },
});

function NauticalRoute_startEditMode() {
  routeDraw = new ol.interaction.Draw({
    type: "LineString",
    source: layer_nautical_route.getSource(),
  });
  // once drawing starts -> listen for geometry changes
  routeDraw.on("drawstart", (event) => {
    const geom = event.feature.getGeometry();

    geom.on("change", () => {
      const coords = geom.getCoordinates();
      routeTrack = coords.map(([x, y]) => ({ x, y }));
      NauticalRoute_getPoints(routeTrack);
    });
  });
  routeDraw.on("drawend", NauticalRoute_routeAdded);
  routeEdit = new ol.interaction.Modify({
    source: layer_nautical_route.getSource(),
    style: modifyStyle,
  });
  // on start of a modification -> listen for geometry changes
  routeEdit.on("modifystart", (event) => {
    const feature = event.features.item(0);
    const geom = feature.getGeometry();

    geom.on("change", () => {
      routeTrack = geom.getCoordinates().map(([x, y]) => ({ x, y }));
      NauticalRoute_getPoints(routeTrack);
    });
  });
  routeEdit.on("modifyend", NauticalRoute_routeModified);
  map.addInteraction(routeDraw);
  map.addInteraction(routeEdit);
  routeDraw.setActive(true);
  routeEdit.setActive(false);
  layer_nautical_route.setStyle((feature) => {
    return modifyStyle;
  });
}

function NauticalRoute_stopEditMode() {
  if (!routeDraw) {
    return;
  }
  layer_nautical_route.un("addfeature", NauticalRoute_routeAdded);
  routeDraw.setActive(false);
  routeEdit.setActive(false);
  map.removeInteraction(routeEdit);
  map.removeInteraction(routeDraw);
  layer_nautical_route.getSource().clear();
}

function NauticalRoute_DownloadTrack() {
  var format = document.getElementById("routeFormat").value;
  var name = document.getElementById("tripName").value;
  var mimetype, filename;

  if (name == "") {
    name = "route";
  }

  switch (format) {
    case "CSV":
      mimetype = "text/csv";
      filename = name + ".csv";
      content = NauticalRoute_getRouteCsv(routeTrack);
      break;
    case "KML":
      mimetype = "application/vnd.google-earth.kml+xml";
      filename = name + ".kml";
      content = NauticalRoute_getRouteKml(routeObject);
      break;
    case "GPX":
      mimetype = "application/gpx+xml";
      filename = name + ".gpx";
      content = NauticalRoute_getRouteGpx(routeObject);
      break;
    case "GML":
      mimetype = "application/gml+xml";
      filename = name + ".gml";
      content = NauticalRoute_getRouteGml(routeTrack);
      break;
  }

  // Remove previous added forms
  document.querySelector("#actionDialog > form")?.remove();

  form = document.createElement("form");
  form.id = this.id + "_export_form";
  form.method = "post";
  form.action = "./api/export.php";
  document.getElementById("actionDialog").appendChild(form);
  div = document.createElement("div");
  div.className = this.displayClass + "Control";
  form.appendChild(div);
  input = document.createElement("input");
  input.id = this.id + "_export_input_mimetype";
  input.name = "mimetype";
  input.type = "hidden";
  input.value = mimetype;
  div.appendChild(input);
  input = document.createElement("input");
  input.id = this.id + "_export_input_filename";
  input.name = "filename";
  input.type = "hidden";
  input.value = filename;
  div.appendChild(input);
  input = document.createElement("input");
  input.id = this.id + "_export_input_content";
  input.name = "content";
  input.type = "hidden";
  input.value = content;
  div.appendChild(input);

  document.querySelector("#actionDialog > form").submit();

  routeChanged = false;
}

function NauticalRoute_routeAdded(event) {
  routeChanged = true;
  routeDraw.setActive(false);
  routeEdit.setActive(true);
  NauticalRoute_routeModified(event);
}

function NauticalRoute_routeModified(event) {
  routeObject = event.feature || event.features.item(0);
  routeTrack = routeObject
    .getGeometry()
    .getCoordinates()
    .map(([x, y]) => ({ x, y }));
  NauticalRoute_getPoints(routeTrack);
  document.getElementById("buttonRouteDownloadTrack").disabled = false;
}

function NauticalRoute_getPoints(points) {
  let deletedIndex = -1;
  let addedIndex = -1;

  const inputs = Array.from(document.querySelectorAll("#routeSegmentList input[id^='desc_']"));
  let currentValues = inputs.map(input => input.value);

  // Detect deletion
  if (previousPoints.length > points.length) {
    for (let i = 0; i < previousPoints.length; i++) {
      if (!points[i] ||
          Math.abs(points[i].x - previousPoints[i].x) > 1e-6 ||
          Math.abs(points[i].y - previousPoints[i].y) > 1e-6) {
        deletedIndex = i - 1; // adjust for comment
        break;
      }
    }
    if (deletedIndex >= 0) {
      currentValues.splice(deletedIndex, 1); // remove deleted point
    }
  }
  // Detect addition
  else if (previousPoints.length < points.length) {
    for (let i = 0; i < previousPoints.length; i++) {
      if (!points[i] ||
          Math.abs(points[i].x - previousPoints[i].x) > 1e-6 ||
          Math.abs(points[i].y - previousPoints[i].y) > 1e-6) {
        addedIndex = i + 1;
        break;
      }
    }
    if (addedIndex >= 0) {
      currentValues.splice(addedIndex, 0, ""); // insert empty placeholder
    }
  }



  // store current points for next comparison
  previousPoints = points.map(p => ({ ...p })); // shallow copy

  var htmlText;
  var distance, bearing;
  var totalDistance = 0;
  var distUnits = document.getElementById("distUnits").value;

  // function to format coordinates
  var coordFormat = function (lat, lon) {
    return (
      formatCoords(lat, "N __.___°") + " - " + formatCoords(lon, "W___.___°")
    );
  };

  // use DMS format if selected
  if (document.getElementById("coordFormat").value == "coordFormatdms") {
    coordFormat = function (lat, lon) {
      return formatCoords(lat, "N __°##'##\"") + " - " + formatCoords(lon, "W___°##'##\"");
    };
  }

  // start building table HTML
  htmlText = '<table id="routeSegmentList">';
  htmlText += "<tr><th/>" +
              "<th>" + tableTextNauticalRouteCourse + "</th>" +
              "<th>" + tableTextNauticalRouteDistance + "</th>" +
              "<th>" + tableTextNauticalRouteCoordinate + "</th>" +
              "<th>" + tableTextNauticalRouteDescription + "</th>" + 
              "</tr>";

  // loop through points to calculate distance, bearing and render table rows
  for (i = 0; i < points.length - 1; i++) {
    const [lonA, latA] = ol.proj.toLonLat([points[i].x, points[i].y]);
    const [lonB, latB] = ol.proj.toLonLat([points[i + 1].x, points[i + 1].y]);
    distance = getDistance(latA, latB, lonA, lonB);
    if (distUnits == "km") {
      distance = nm2km(distance);
    }
    bearing = getBearing(latA, latB, lonA, lonB);
    totalDistance += distance;
    // restore previous input value if available
    const descValue = currentValues[i] || "";
    htmlText += "<tr>" +
              "<td>" + (i + 1) + ".</td>" +
              "<td>" + bearing.toFixed(2) + "°</td>" +
              "<td>" + distance.toFixed(2) + " " + distUnits + "</td>" +
              "<td>" + coordFormat(latB, lonB) + "</td>" +
              "<td><input type='text' id='desc_" + i + "' value='" + descValue + "'></td>" +
              "</tr>";
  }
  htmlText += "</table>";

  // display start and end coordinates 
  const [lon0, lat0] = ol.proj.toLonLat([points[0].x, points[0].y]);
  const [lon1, lat1] = ol.proj.toLonLat([
    points[points.length - 1].x,
    points[points.length - 1].y,
  ]);

  document.getElementById("routeStart").innerHTML = coordFormat(lat0, lon0);
  document.getElementById("routeEnd").innerHTML = coordFormat(lat1, lon1);
  document.getElementById("routeDistance").innerHTML =
    totalDistance.toFixed(2) + " " + distUnits;
  document.getElementById("routePoints").innerHTML = htmlText;
}

function NauticalRoute_getRouteCsv(points) {
  var buffText =
    ";" +
    tableTextNauticalRouteCourse +
    ";" +
    tableTextNauticalRouteDistance +
    ";" +
    tableTextNauticalRouteCoordinate +
    ";" +
    tableTextNauticalRouteDescription +
    "\n";
  var totalDistance = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const [lonA, latA] = ol.proj.toLonLat([points[i].x, points[i].y]);
    const [lonB, latB] = ol.proj.toLonLat([points[i + 1].x, points[i + 1].y]);

    const distance = getDistance(latA, latB, lonA, lonB).toFixed(2);
    const bearing = getBearing(latA, latB, lonA, lonB).toFixed(2);
    totalDistance += parseFloat(distance);

    let coordText = "";
    if (document.getElementById("coordFormat").value == "coordFormatdms") {
      coordText = formatCoords(latB, "N___°##.####'") + " - " + formatCoords(lonB, "W___°##.####'");
    } else {
      coordText = formatCoords(latB, "N __.___°") + " - " + formatCoords(lonB, "W___.___°");
    }

    const description = document.getElementById("desc_" + i)?.value || "";

    buffText +=
      parseInt(i + 1) + ";" +
      bearing + "°;" +
      distance + "nm;\"" +
      coordText + "\";\"" +
      description + "\"\n";
  }

  return convert2Text(buffText);
}

function NauticalRoute_getRouteKml(feature) {
  // create KML parser
  var parser = new ol.format.KML();

  // check if geometry is LineString
  if (feature.getGeometry().getType() === "LineString") {
    const coords = feature.getGeometry().getCoordinates();
    let descriptions = [];

    // iterate through coordinates and get descriptions
    coords.forEach((coord, i) => {
      let desc = feature.get("descriptions")?.[i] || "";
      descriptions.push(`Point ${i + 1}: ${desc}`);
    });

    // set combined descriptions as feature property
    feature.set("description", descriptions.join("\n"));
  }

  // export feature as KML
  return parser.writeFeatures([feature], {
    featureProjection: map.getView().getProjection(),
    dataProjection: "EPSG:4326",
  });
}

function NauticalRoute_getRouteGpx(feature) {
  // create GPX parser
  var parser = new ol.format.GPX();

  // check if geometry is LineString
  if (feature.getGeometry().getType() === "LineString") {
    const coords = feature.getGeometry().getCoordinates();
    let descriptions = [];

    // iterate through coordinates and get descriptions
    coords.forEach((coord, i) => {
      let desc = feature.get("descriptions")?.[i] || "";
      descriptions.push(`Point ${i + 1}: ${desc}`);
    });

    // set combined descriptions as feature property
    feature.set("description", descriptions.join("\n"));
  }

  // export feature as GPX
  return parser.writeFeatures([feature], {
    featureProjection: map.getView().getProjection(),
    dataProjection: "EPSG:4326",
  });
}

function NauticalRoute_getRouteGml(points, descriptions) {
  // build coordinates text
  let coordText = "";
  for (let i = 0; i < points.length; i++) {
    const [lonA, latA] = ol.proj.toLonLat([points[i].x, points[i].y]);
    coordText += lonA + "," + latA + " ";
  }

  // build description text
  let descText = "";
  if (descriptions && descriptions.length > 0) {
    descText = descriptions.map((d, i) => `Point ${i + 1}: ${d}`).join("\n");
  } else {
    descText = "No description available";
  }

  // return GML string
  const gml = `
<gml:featureMember xmlns:gml="http://www.opengis.net/gml" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.opengis.net/gml http://schemas.opengis.net/gml/2.1.2/feature.xsd">
    <gml:null>
        <gml:description>${descText}</gml:description>
        <gml:geometry>
            <gml:LineString>
                <gml:coordinates decimal="." cs="," ts=" ">${coordText}</gml:coordinates>
            </gml:LineString>
        </gml:geometry>
    </gml:null>
</gml:featureMember>
`;
  return gml;
}
