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
- **La suppression d'un accessoire dans Maison ne nettoie pas toujours le fabric Matter.** Il peut rester une trace de l'appairage ; dans ce cas il faut aussi le supprimer depuis Réglages iOS (Réglages > [votre nom] > Matter, ou Réglages > Maison).
- **Des erreurs `unsupported path: Status=195` peuvent apparaître dans les logs matter.js.** Apple interroge des clusters (`BridgedBasicInformation`, OTA) sur le root endpoint du bridge alors qu'ils n'existent pas à cet endroit selon le standard Matter. Ces erreurs sont inoffensives et sans rapport avec un bug du plugin.
