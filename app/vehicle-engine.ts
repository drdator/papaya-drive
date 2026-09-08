import * as THREE from 'three';

export function createVehicleEngine() {
  const group = new THREE.Group();
  group.name = 'Engine_bay';
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 10);
  const dark = new THREE.MeshStandardMaterial({
    color: '#303733',
    roughness: 0.85,
  });
  const metal = new THREE.MeshStandardMaterial({
    color: '#929b95',
    roughness: 0.5,
    metalness: 0.45,
  });
  const rubber = new THREE.MeshStandardMaterial({
    color: '#171e1b',
    roughness: 0.95,
  });
  const red = new THREE.MeshStandardMaterial({
    color: '#af4934',
    roughness: 0.7,
  });

  function part(
    name: string,
    material: THREE.Material,
    position: [number, number, number],
    size: [number, number, number],
    geometry: THREE.BufferGeometry = box,
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = `Engine_${name}`;
    mesh.position.set(...position);
    mesh.scale.set(...size);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // Keep the assembly below the closed hood and inside the front fenders.
  part('tray', dark, [0, 0.54, 1.18], [1.4, 0.07, 1.02]);
  part('block', dark, [0.03, 0.7, 1.16], [0.62, 0.25, 0.67]);
  part('valve_cover', metal, [0.03, 0.86, 1.16], [0.55, 0.14, 0.59]);
  for (let i = 0; i < 4; i++)
    part(
      `cover_rib_${i}`,
      metal,
      [-0.15 + i * 0.12, 0.94, 1.16],
      [0.035, 0.025, 0.48],
    );
  part('oil_cap', rubber, [0.17, 0.947, 0.95], [0.06, 0.035, 0.06], cylinder);
  part('air_filter', rubber, [-0.48, 0.82, 1.07], [0.18, 0.12, 0.18], cylinder);
  part(
    'filter_lid',
    metal,
    [-0.48, 0.89, 1.07],
    [0.185, 0.025, 0.185],
    cylinder,
  );
  part('intake', rubber, [-0.29, 0.79, 1.07], [0.25, 0.1, 0.12]);
  part('battery', rubber, [0.51, 0.7, 0.97], [0.25, 0.24, 0.3]);
  part('battery_terminal', red, [0.56, 0.837, 0.9], [0.065, 0.035, 0.07]);
  part('radiator', rubber, [0, 0.72, 1.61], [1.06, 0.32, 0.1]);
  for (let i = 0; i < 7; i++)
    part(
      `radiator_fin_${i}`,
      metal,
      [-0.42 + i * 0.14, 0.72, 1.548],
      [0.035, 0.25, 0.02],
    );

  return {
    group,
    dispose() {
      group.removeFromParent();
      box.dispose();
      cylinder.dispose();
      for (const material of [dark, metal, rubber, red]) material.dispose();
    },
  };
}
