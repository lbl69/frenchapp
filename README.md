# Tuteur de langues (hors-ligne)

Un tuteur de langues personnel propulsé par l'IA, qui **fonctionne sans Internet**. L'application suit le prompt « personal language tutor » : conversation, corrections détaillées (❌ ✅ 💡 🔁), histoires, grammaire, quiz, plan de leçons, défi du jour, culture, et résumé de fin de séance.

Tout reste sur l'appareil : aucune donnée n'est envoyée à un serveur.

## Fonctionnalités

- **Profil** : langue apprise, niveau, objectif, langue des explications.
- **Actions rapides** : jeu de rôle, correction de texte, histoire, grammaire, quiz, « que faire ensuite ? », défi du jour, culture.
- **Mémoire** : le tuteur repère le vocabulaire qu'il t'enseigne et les erreurs qu'il corrige. Il les enregistre, puis les réutilise et t'interroge dessus d'une séance à l'autre.
- **Séances** : historique local, bouton 🏁 *Terminer* pour obtenir le résumé de la séance.
- **Prononciation** : bouton 🔊 qui utilise les voix du système (fonctionne hors-ligne).
- **Sauvegarde** : export/import JSON de toutes tes données.
- **PWA** : installable sur ordinateur et mobile, l'interface s'ouvre sans connexion.

## Deux moteurs d'IA, tous deux hors-ligne

| Moteur | Installation | Hors-ligne |
|---|---|---|
| **Dans le navigateur** (WebLLM + WebGPU) | Rien à installer | Après un premier téléchargement du modèle (1 à 6 Go), mis en cache |
| **Serveur local** (Ollama, LM Studio, llama.cpp…) | Installer le serveur et un modèle | Toujours |

Le moteur WebLLM demande un navigateur avec WebGPU : Chrome/Edge récents, ou Safari 26 et plus. Pour le français, *Qwen 3.5 4B* est un bon compromis. *Mistral 7B* ou *Qwen 3.5 9B* sont meilleurs si ta machine a assez de mémoire.

### Avec Ollama

```bash
ollama pull mistral
OLLAMA_ORIGINS="*" ollama serve
```

Dans les réglages, choisis « Serveur local », garde l'adresse `http://localhost:11434/v1` et clique sur *Détecter*.
`OLLAMA_ORIGINS` sert à autoriser la page à parler à Ollama. Ce n'est pas nécessaire si l'app est servie depuis `localhost`.

## Lancer l'app

C'est un site statique, sans étape de build. Il faut juste le servir en HTTP (pas en `file://`) :

```bash
python3 -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>.

### Publier sur GitHub Pages

Dans le dépôt GitHub, va dans *Settings → Pages → Build and deployment*, choisis *Deploy from a branch*, puis la branche `main` et le dossier `/ (root)`. L'app sera publiée sur `https://<utilisateur>.github.io/<dépôt>/`. Ouvre l'URL une fois avec une connexion, puis installe l'app (« Installer » / « Ajouter à l'écran d'accueil »). Elle fonctionne ensuite hors-ligne.

## Structure

```
index.html            interface
css/style.css         styles (clair/sombre)
js/app.js             logique : séances, mémoire, réglages
js/prompt.js          prompt système du tuteur
js/engines.js         moteurs WebLLM et serveur local (API compatible OpenAI)
js/markdown.js        rendu Markdown minimal
sw.js                 service worker (cache hors-ligne)
vendor/web-llm/       @mlc-ai/web-llm 0.2.84 (Apache-2.0), inclus pour fonctionner hors-ligne
```

Pour modifier le comportement du tuteur, édite `js/prompt.js`. Après avoir modifié des fichiers, incrémente `VERSION` dans `sw.js`.
