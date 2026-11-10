# homebridge-jeedom

Homebridge plugin for Jeedom.

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/NebzHB/homebridge-jeedom/badge)](https://scorecard.dev/viewer/?uri=github.com/NebzHB/homebridge-jeedom)

| Branch | Build |
|---|---|
| `alpha` | [![Build (alpha)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=alpha)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Aalpha) |
| `beta` | [![Build (beta)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=beta)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Abeta) |
| `master` | [![Build (master)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml/badge.svg?branch=master)](https://github.com/NebzHB/homebridge-jeedom/actions/workflows/build.yml?query=branch%3Amaster) |

## Support Matter

### Prérequis

- **Homebridge 2.5.0 minimum** (installé par les dépendances du plugin Jeedom). Les versions précédentes ont des bugs Matter que le plugin ne contourne plus (couleurs des lumières, température des thermostats, accessoires perdus du cache).
- Matter activé dans la configuration du plugin Jeedom.

### Types supportés

- **Prises** : on/off, puissance instantanée (`POWER`), énergie cumulée : la consommation (`CONSUMPTION`) est envoyée en énergie importée et la production (type générique `PRODUCTION`) en énergie exportée. Sans commande `PRODUCTION`, une consommation négative est envoyée en énergie exportée. Multi-prises : puissance, consommation et production rattachées à chaque prise dans l'ordre des commandes, s'il y en a autant que de prises.
- **Interrupteurs** et **scénarios** : exposés comme des prises.
- **Lumières** : le type Matter dépend des commandes Jeedom :
  - sans Action/Lumière Slider : on/off (même avec une couleur) ;
  - slider seul : variateur ;
  - slider + température couleur (info et action) : température couleur, avec la plage min/max de l'action ;
  - slider + couleur (info et action) : couleur + température couleur. Sans action température couleur, la température couleur est émulée en RGB (153 à 500 mireds).
  - Allumer une lumière sans Action/Lumière On la rallume à sa dernière luminosité.
- **Mouvement** et **présence** (même type en Matter : occupation).
- **Contact** (porte, fenêtre).
- **Température**, **humidité**, **luminosité** (éclairement).
- **Fumée**.
- **Fuite d'eau** (inondation).
- **Batterie** : le cluster Matter `powerSource` (niveau en %, alerte de niveau bas, état de charge si l'équipement a une commande `BATTERY_CHARGING`, sinon « inconnu » ; en charge avec un niveau > 95 % = « pleine charge ») est ajouté à chaque accessoire Matter d'un équipement Jeedom qui a une commande batterie (type générique `BATTERY`). Chaque accessoire d'un même équipement étant une tuile distincte dans Maison, la batterie apparaît sur chacune.

### Fonctionnement

- **Nom** : le nom de l'équipement (32 caractères maximum en Matter). La pièce et le nom d'origine (`Pièce>Nom`) sont dans le fabricant, l'id Jeedom dans le numéro de série.
- **Identifier** (Maison, ou à l'ajout du pont) : l'accessoire est noté dans le log et une notification s'affiche sur la page de configuration du plugin Jeedom.
- **Après un redémarrage de Homebridge** : Homebridge et matter.js gardent l'état des accessoires Matter en cache (celui du démarrage précédent). Le plugin renvoie l'état actuel de Jeedom une fois les accessoires enregistrés : états, plages, nom et pièce. Le log indique `[Matter] <nom> : état remis à jour (...)` pour chaque accessoire corrigé.
- **Suppression** : un équipement retiré, désactivé ou décoché dans Jeedom est aussi retiré de Matter (y compris ce qui reste dans le cache Matter).

### Limitations connues du plugin

- **Puissance, consommation et production** ne sont envoyées à Matter que pour les prises. Sur un autre équipement (lumière, capteur…), elles sont ignorées en Matter.
- **Prise avec consommation ou production mais sans puissance** : la valeur Matter n'est lue qu'au démarrage (pas de mise à jour en direct).
- **Production** : n'existe pas en HomeKit (ni caractéristique HAP, ni Eve), visible uniquement en Matter.
- **Lumières** :
  - un variateur maintenu (variation continue) ne met pas à jour Jeedom pendant le mouvement : Jeedom reçoit la luminosité à son prochain changement ;
  - la variation continue de la température couleur (`move` / `step`) n'est pas transmise à Jeedom ;
  - une lumière couleur sans slider reste on/off (toute lumière Matter couleur a un niveau).
- **Commande ajoutée dans Jeedom à un accessoire Matter existant** (ex. une puissance sur une prise) : elle n'apparaît pas en Matter tant que l'accessoire n'est pas recréé (Homebridge ne compare pas ces clusters au redémarrage).
- **Luminosité inférieure à 1 lux** : envoyée comme 1 lux.

### Limitations connues côté Homebridge / matter.js

- **Erreurs non remontées** : Homebridge ne renvoie pas au plugin les erreurs de mise à jour d'un état Matter ; elles sont seulement dans son propre log (`Failed to update Matter accessory state`).
- **Avertissement `Identify.TriggerEffect missing`** (log debug) sur les lumières et prises : la commande Identify de Homebridge n'implémente pas TriggerEffect. Sans effet connu sur Apple Home.

### Limitations connues côté Apple Home / iOS

Ces restrictions viennent de l'app Apple Maison et de sa gestion de Matter, pas du plugin :

- **Le bridge Matter s'affiche "Matter Accessory" dans Maison, pas "Jeedom".** C'est documenté par le projet matter.js lui-même : Apple ignore systématiquement le nom fourni pour le bridge racine et affiche toujours "Matter Accessory", quelle que soit la configuration. En revanche, les accessoires à l'intérieur du bridge (interrupteurs, scénarios, etc.) sont bien nommés correctement.
- **La suppression d'un accessoire dans Maison ne nettoie pas toujours le fabric Matter.** Il peut rester une trace de l'appairage ; dans ce cas il faut aussi le supprimer depuis Réglages iOS (Maison > ... > Réglages du domicile > Services connectés et/ou Réglages du téléphone > Général > Accessoires Matter).
- **Des erreurs `unsupported path: Status=195` peuvent apparaître dans les logs matter.js.** Apple interroge des clusters (`BridgedBasicInformation`, OTA) sur le root endpoint du bridge alors qu'ils n'existent pas à cet endroit selon le standard Matter. Ces erreurs sont inoffensives et sans rapport avec un bug du plugin.
- **La puissance instantanée s'affiche dans le résumé Énergie de Maison, mais pas la conso totale/cumulée.** Le plugin envoie bien les deux clusters Matter (`electricalPowerMeasurement` et `electricalEnergyMeasurement`). L'affichage du cumul/historique par Apple Home n'est pas encore fiable pour des accessoires Matter tiers ([homebridge#3942](https://github.com/homebridge/homebridge/issues/3942), [homebridge#3989](https://github.com/homebridge/homebridge/issues/3989)). Côté HAP classique, ce suivi fonctionne via l'app Eve (caractéristiques Eve et fakegato).
- **Lumières couleur** : Maison affiche le dernier attribut couleur modifié (couleur ou température couleur), quel que soit le mode couleur annoncé. Le plugin n'envoie donc que les valeurs du mode en cours.

### À venir

- Thermostats (en cours)
- Volets et BSO
- Ventilateurs
- Serrures
- Qualité d'air (PM2.5, PM10)
- Capteur CO
- Robots aspirateurs
- Interrupteurs programmables (multi-valeur et binaire)
- Bouton push
