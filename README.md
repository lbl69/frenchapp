# Tuteur de langues

Un tuteur de langues personnel propulsé par **Claude** (Anthropic). L'application suit le prompt « personal language tutor » : conversation, corrections détaillées (❌ ✅ 💡 🔁), histoires, grammaire, quiz, plan de leçons, défi du jour, culture, et résumé de fin de séance.

C'est un site statique, sans serveur : le navigateur appelle directement l'API Claude avec ta clé.

## Fonctionnalités

- **Profil** : langue apprise, niveau, objectif, langue des explications.
- **Actions rapides** : jeu de rôle, correction de texte, histoire, grammaire, quiz, « que faire ensuite ? », défi du jour, culture.
- **Mémoire** : le tuteur repère le vocabulaire qu'il t'enseigne et les erreurs qu'il corrige. Il les enregistre, puis les réutilise et t'interroge dessus d'une séance à l'autre.
- **Séances** : historique local, bouton 🏁 *Terminer* pour obtenir le résumé de la séance.
- **Prononciation** : bouton 🔊 qui utilise les voix du système.
- **Sauvegarde** : export/import JSON de tes séances et de ton vocabulaire. La clé API n'est jamais exportée.
- **PWA** : installable sur ordinateur et mobile. L'historique reste consultable sans connexion, mais parler au tuteur demande Internet.

## Démarrer

1. Crée une clé API sur [console.anthropic.com](https://console.anthropic.com/settings/keys) et ajoute un peu de crédit (*Billing*).
2. Ouvre l'app, puis colle la clé dans **⚙️ Réglages → Clé API**.
3. Choisis le modèle :
   - **Claude Haiku 5.5** (par défaut) : rapide et très économique, environ un centime par séance.
   - **Claude Sonnet 5.5** : explications et corrections plus fines, environ 20 fois plus cher que Haiku, mais une séance reste de l'ordre de quelques dizaines de centimes.

La clé est stockée uniquement dans le navigateur de cet appareil (`localStorage`) et n'est envoyée qu'à `api.anthropic.com`. Comme toute clé utilisée côté navigateur, ne l'utilise que sur un appareil qui t'appartient. Tu peux fixer un plafond de dépense mensuel dans la console Anthropic.

### Détails techniques

- Appels via le SDK officiel `@anthropic-ai/sdk`, chargé depuis jsDelivr, avec `dangerouslyAllowBrowser: true`.
- Réponses en streaming, effort `low` (un tuteur qui converse n'a pas besoin de longue réflexion).
- Le prompt du tuteur est mis en cache (*prompt caching*) : il ne coûte presque rien à partir du 2e message d'une séance.
- Sur Sonnet 5.5, si un filtre de sécurité refuse un message à tort, l'API bascule automatiquement sur un autre modèle (`fallbacks: "default"`).

### Option : serveur local

L'app peut aussi utiliser un serveur local compatible OpenAI (Ollama, LM Studio…), sans clé :

```bash
ollama pull mistral
OLLAMA_ORIGINS="*" ollama serve
```

Dans les réglages, choisis « Serveur local » et clique sur *Détecter*.

## Lancer en local

```bash
python3 -m http.server 8000
```

Ouvre ensuite <http://localhost:8000>.

### Publier sur GitHub Pages

Dans le dépôt GitHub, va dans *Settings → Pages → Build and deployment*, choisis *Deploy from a branch*, puis la branche `main` et le dossier `/ (root)`.

## Structure

```
index.html            interface
css/style.css         styles (clair/sombre)
js/app.js             logique : séances, mémoire, réglages
js/prompt.js          prompt système du tuteur
js/engines.js         API Claude et serveur local
js/markdown.js        rendu Markdown minimal
sw.js                 service worker (installation, interface hors connexion)
```

Pour modifier le comportement du tuteur, édite `js/prompt.js`. Après avoir modifié des fichiers, incrémente `VERSION` dans `sw.js`.
