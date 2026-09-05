import { contract, discovery, semanticDiff } from "../src/index.ts";

export const orbitC = contract({
  dna: "1.0",
  id: "acme:orbit-c",
  revision: "C",
  publisher: "acme.example",
  authorities: [
    { id: "authority.manufacturer", href: "https://acme.example", kind: "manufacturer" },
    { id: "evidence.remote-diagnostics", href: "https://acme.example/evidence/rd-c", kind: "test-report" },
  ],
  entities: [
    { id: "product.orbit", type: "industrial-controller", revision: "C", name: "Orbit Controller" },
    { id: "interface.service-usb", type: "usb-c-service-port", revision: "1", name: "Service USB-C" },
  ],
  capabilities: [
    { id: "capability.remote-diagnostics", subject: "product.orbit", status: "available" },
    { id: "capability.field-firmware-update", subject: "product.orbit", status: "available" },
  ],
  claims: [
    {
      id: "claim.remote-diagnostics",
      subject: "product.orbit",
      text: "Remote diagnostics is available for service workflows.",
      evidence: ["evidence.remote-diagnostics"],
    },
  ],
  relations: [
    { from: "product.orbit", type: "has-interface", to: "interface.service-usb" },
    { from: "product.orbit", type: "has-capability", to: "capability.remote-diagnostics" },
    { from: "claim.remote-diagnostics", type: "supports-claim", to: "evidence.remote-diagnostics" },
  ],
});

export const orbitD = contract({
  ...orbitC,
  id: "acme:orbit-d",
  revision: "D",
  entities: orbitC.entities.map(entity => entity.id === "product.orbit" ? { ...entity, revision: "D" } : entity),
  capabilities: [
    ...orbitC.capabilities,
    { id: "capability.remote-firmware-update", subject: "product.orbit", status: "available" },
  ],
  relations: [
    ...orbitC.relations,
    { from: "product.orbit", type: "has-capability", to: "capability.remote-firmware-update" },
  ],
});

export const wellKnown = discovery({
  dna: "1.0",
  publisher: "acme.example",
  contracts: ["https://acme.example/dna/orbit-c.json", "https://acme.example/dna/orbit-d.json"],
});

export const changes = semanticDiff(orbitC, orbitD);
