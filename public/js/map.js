// Leaflet map with the seven ghats as numbered, tier-coloured markers.
/* global L */

import { state, select, onSelect, el, h } from './util.js';

export function renderMap() {
  const { model } = state;
  const map = L.map('map', { scrollWheelZoom: false, zoomControl: true, attributionControl: true });
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);

  const markers = new Map();
  for (const g of model.ghats) {
    const iconFor = (selected) => L.divIcon({
      className: '',
      html: `<div class="pin t-${g.tier}${selected ? ' selected' : ''}">${g.rank}</div>`,
      iconSize: [28, 28],
      iconAnchor: [14, 14],
    });
    const m = L.marker([g.location.lat, g.location.lng], { icon: iconFor(false), title: g.site, keyboard: true, riseOnHover: true })
      .addTo(map)
      .bindTooltip(`<b>#${g.rank} ${g.short}</b> · ${model.tiers[g.tier].en}<br><span style="color:#777">Position: ${g.location.precision}</span>`, { direction: 'top', offset: [0, -14] })
      .on('click', () => select(g.id, { from: 'map' }));
    markers.set(g.id, { m, iconFor });
  }
  map.fitBounds(L.latLngBounds(model.ghats.map((g) => [g.location.lat, g.location.lng])), { padding: [28, 28] });

  onSelect((id) => {
    for (const [gid, { m, iconFor }] of markers) {
      m.setIcon(iconFor(gid === id));
      m.setZIndexOffset(gid === id ? 1000 : 0);
    }
    const g = state.ghatById.get(id);
    el('map-foot').replaceChildren(
      h('span', {}, `#${g.rank} ${g.short}: ${g.location.note}`),
      h('span', {}, 'Positions are approximate (OpenStreetMap), not surveyed.'),
    );
  });
}
