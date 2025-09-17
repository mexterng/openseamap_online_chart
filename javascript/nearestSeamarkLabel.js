// helper: distance between two coordinates in meters
function getDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000; // Earth radius in meters
  const toRad = x => (x * Math.PI) / 180;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dPhi = toRad(lat2 - lat1);
  const dLamda = toRad(lon2 - lon1);

  // haversine formula
  const a =
    Math.sin(dPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLamda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

// helper: append suffix only if value is defined
function appendIfDefined(value, suffix) {
  return value ? value + suffix : "";
}

function formatFeature(el, distanceNm) {
  distanceNm = distanceNm.toFixed(1);
  const tags = el.tags || {};
  const type = tags["seamark:type"] || tags.man_made || tags.place;

  // Lighthouses / Lights
  if (type === "lighthouse" || type === "light_minor" || type === "light_major") {
    let lightStr = "";
    if (tags["seamark:light:character"]) {
      let colour = appendIfDefined(tags["seamark:light:colour"][0].toUpperCase(), ".");
      if (colour === "W."){
        colour = "";
      }
      const period = appendIfDefined(tags["seamark:light:period"], "s");
      const height = appendIfDefined(tags["seamark:light:height"], "m");
      const range  = appendIfDefined(tags["seamark:light:range"], "M");
      lightStr = `; ${tags["seamark:light:character"]}.${colour}${period}${height}${range}`;
    }
    return `${tags["seamark:name"] || "Unnamed Light"}${lightStr} (${distanceNm} sm)`;
  }

  // Lateral beacons
  if (type === "beacon_lateral") {
    let lightStr = "";
    if (tags["seamark:light:character"]) {
      let colour = appendIfDefined(tags["seamark:light:colour"][0].toUpperCase(), ".");
      if (colour === "W."){
        colour = "";
      }
      const period = appendIfDefined(tags["seamark:light:period"], "s");
      lightStr = `; ${tags["seamark:light:character"]}.${colour}${period}`;
    }
    return `Beacon ${tags["seamark:beacon_lateral:category"] || ""}${lightStr} (${distanceNm} sm)`;
  }

  // Other beacons / buoys
  if (type && type.startsWith("beacon")) {
    return `Beacon (${distanceNm} sm)`;
  }

  // Cities / Islands
  if (tags.place) {
    return `${tags.name} (${distanceNm} sm)`;
  }

  // Fallback
  return `Unknown (${distanceNm} sm)`;
}

// Function: find nearest navigation feature
async function getNearestSeamarkLabel(lat, lon) {
  const radius = 5000; // search radius in meters
  const query = `
    [out:json];
    (
      // Lighthouses
      node["man_made"="lighthouse"](around:${radius},${lat},${lon});

      // Lights
      node["seamark:type"="light_major"](around:${radius},${lat},${lon});
      node["seamark:type"="light_minor"](around:${radius},${lat},${lon});

      // Buoys
      node["seamark:type"="buoy"](around:${radius},${lat},${lon});

      // Beacons
      node["seamark:type"="beacon_cardinal"](around:${radius},${lat},${lon});
      node["seamark:type"="beacon_lateral"](around:${radius},${lat},${lon});
      node["seamark:type"="beacon_isolated_danger"](around:${radius},${lat},${lon});

      // Cities & villages
      node["place"~"city|town|village"]["name"](around:${radius},${lat},${lon});

      // Islands (als node, way, relation)
      node["place"~"island|islet"]["name"](around:${radius},${lat},${lon});
      way["place"~"island|islet"]["name"](around:${radius},${lat},${lon});
      relation["place"~"island|islet"]["name"](around:${radius},${lat},${lon});
    );
    out body;
  `;
  const url = "https://overpass-api.de/api/interpreter?data=" + encodeURIComponent(query);

  try {
    const response = await fetch(url);
    const data = await response.json();
    if (!data.elements || data.elements.length === 0) return [];

    // compute distance for each element
    data.elements.forEach(el => {
      el.distanceNm = getDistance(lat, lon, el.lat, el.lon) / 1852; // meters to nautical miles
    });
    // sort by distance
    data.elements.sort((a, b) => a.distanceNm - b.distanceNm);

    // take 10 nearest and format
    nearest = data.elements.slice(0, 10);

    // TODO: delete console log in production
    console.log(nearest.map(el => ({
      id: el.id,
      raw: el,
      label: formatFeature(el, el.distanceNm)
    })));

    return nearest.map(el => formatFeature(el, el.distanceNm));
  } catch (err) {
    console.error("Error fetching nearest seamark label:", err);
    return null;
  }
}

async function popupNearestSeamarkLabel(lat, lon, description_id){
  // Check if a popup already exists
  if (document.getElementById("dropdownNearestSeamarkLabel")) return;
  const options = await getNearestSeamarkLabel(lat, lon); // resolve Promise
  showDropdownPopup(options, selected => {
    if (selected !== null) {
      document.getElementById(description_id).value = selected;
    }
  });
}

// Show dropdown in modal and return selected value
function showDropdownPopup(options, callback) {
  if (!options || options.length === 0) {
    alert("No options available.");
    return;
  }

  // Create modal background
  const modalBg = document.createElement("div");
  modalBg.id = "dropdownNearestSeamarkLabel";
  modalBg.style.position = "fixed";
  modalBg.style.top = "0";
  modalBg.style.left = "0";
  modalBg.style.width = "100%";
  modalBg.style.height = "100%";
  modalBg.style.backgroundColor = "rgba(0, 0, 0, 0.1)";
  modalBg.style.display = "flex";
  modalBg.style.alignItems = "center";
  modalBg.style.justifyContent = "center";
  modalBg.style.zIndex = "9999";
  modalBg.style.pointerEvents = "none";

  // Create modal box
  const modalBox = document.createElement("div");
  modalBox.style.background = "#fff";
  modalBox.style.padding = "20px";
  modalBox.style.borderRadius = "8px";
  modalBox.style.minWidth = "300px";
  modalBox.style.boxShadow = "0 2px 10px rgba(0,0,0,0.3)";
  modalBox.style.pointerEvents = "auto";

  // Dropdown
  const select = document.createElement("select");
  select.style.width = "100%";
  select.style.padding = "5px";

  options.forEach(opt => {
    const option = document.createElement("option");
    option.value = opt;
    option.textContent = opt;
    select.appendChild(option);
  });
  modalBox.appendChild(select);
  
  // Button container
  const btnContainer = document.createElement("div");
  btnContainer.style.marginTop = "10px";
  btnContainer.style.display = "flex";
  btnContainer.style.justifyContent = "space-between";

  // OK button
  const okBtn = document.createElement("button");
  okBtn.textContent = tableTextNearestSeamarkLabelOk;
  okBtn.onclick = () => {
    const selected = select.value;
    document.body.removeChild(modalBg);
    if (callback) callback(selected);
  };

  // Cancel button
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = tableTextNearestSeamarkLabelCancel;
  cancelBtn.onclick = () => {
    document.body.removeChild(modalBg);
    if (callback) callback(null);
  };

  btnContainer.appendChild(okBtn);
  btnContainer.appendChild(cancelBtn);

  modalBox.appendChild(btnContainer);
  modalBg.appendChild(modalBox);
  document.body.appendChild(modalBg);
}