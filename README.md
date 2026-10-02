# homebridge-jeedom

Homebridge plugin for Jeedom.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/NebzHB/homebridge-jeedom/badge)](https://scorecard.dev/viewer/?uri=github.com/NebzHB/homebridge-jeedom)

| Branch | Build |
|---|---|
| `alpha` | [![Build (alpha)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=alpha)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Aalpha) |
| `beta` | [![Build (beta)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=beta)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Abeta) |
| `master` | [![Build (master)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=master)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Amaster) |

## Support Matter

### Limitations connues côté Apple Home / iOS

Ces restrictions viennent de l'app Apple Maison et de sa gestion de Matter, pas du plugin :

- **Le bridge Matter s'affiche "Matter Accessory" dans Maison, pas "Jeedom".** C'est documenté par le projet matter.js lui-même : Apple ignore systématiquement le nom fourni pour le bridge racine et affiche toujours "Matter Accessory", quelle que soit la configuration. En revanche, les accessoires à l'intérieur du bridge (interrupteurs, scénarios, etc.) sont bien nommés correctement.
- **La suppression d'un accessoire dans Maison ne nettoie pas toujours le fabric Matter.** Il peut rester une trace de l'appairage ; dans ce cas il faut aussi le supprimer depuis Réglages iOS (Maison > ... > Réglages du domicile > Services connectés et/ou Réglages du téléphone > Général > Accessoires Matter).
- **Des erreurs `unsupported path: Status=195` peuvent apparaître dans les logs matter.js.** Apple interroge des clusters (`BridgedBasicInformation`, OTA) sur le root endpoint du bridge alors qu'ils n'existent pas à cet endroit selon le standard Matter. Ces erreurs sont inoffensives et sans rapport avec un bug du plugin.
- **La puissance instantanée s'affiche dans le résumé Énergie de Maison, mais pas la conso totale/cumulée.** Le plugin envoie bien les deux clusters Matter (`electricalPowerMeasurement` et `electricalEnergyMeasurement`) de façon symétrique. Le suivi énergétique est un des points encore immatures côté Matter : les device types Matter 1.4 dédiés à l'énergie ne sont pas encore exposés par Homebridge (voir [homebridge#3942](https://github.com/homebridge/homebridge/issues/3942)). La puissance instantanée remonte bien à l'app Énergie ([homebridge#3989](https://github.com/homebridge/homebridge/issues/3989)), mais l'affichage du cumul/historique par Apple Home n'est pas encore fiable pour des accessoires Matter tiers. (Côté HAP classique, ce suivi fonctionne bien via l'app Eve, les custom characteristics et fakegato.)

### Types supportés jusqu'ici

- Prise et consommation instantanée (voir dernière restiction)
- Scenarios (qui sont des prises)
- Interrupteurs (qui sont des prises)
- Présence et Occupation (même type en matter)
- capteur de contact (porte + fenetre)
- température et humidité
- luminosité (illumination, éclairement)
- fumée (smoke)
- innondation, fuite d'eau (leak/flood)

#### Todo
- Volets et BSO
- Thermostats
- Ventilateurs
- Serrures
- Qualité d'air (PM2.5 PM10)
- Capteur CO
- Lumières (on/off, dimmable, température couleur, couleur)
- Robot Aspirateurs
- Interrupteurs programmables (Multi-Valeur et Binaire)
- Bouton Push
- Batterie (peut-etre uniquement sur smoke, pas vu autre part)
