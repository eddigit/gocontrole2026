import type { FastifyInstance } from 'fastify';
import { authenticate } from '../middleware/auth.js';

/**
 * Public legal routes — CGU, Privacy Policy, consent acceptance.
 * CGU and privacy endpoints are PUBLIC (no auth) so they can be shown on login page.
 * Consent acceptance requires auth.
 */
export async function legalRoutes(fastify: FastifyInstance): Promise<void> {
  const { prisma } = fastify.appContext;

  // GET /api/legal/cgu — Public
  fastify.get('/cgu', async () => {
    return { version: '1.0', date: '2026-03-01', content: CGU_CONTENT };
  });

  // GET /api/legal/privacy — Public
  fastify.get('/privacy', async () => {
    return { version: '1.0', date: '2026-03-01', content: PRIVACY_CONTENT };
  });

  // POST /api/legal/accept — Authenticated: user accepts CGU + Privacy
  fastify.post('/accept', { preHandler: [authenticate] }, async (request) => {
    const now = new Date();
    const user = await prisma.user.update({
      where: { id: request.user.userId },
      data: {
        cguAcceptedAt: now,
        privacyAcceptedAt: now,
      },
      select: { id: true, cguAcceptedAt: true, privacyAcceptedAt: true },
    });
    return { accepted: true, user };
  });

  // GET /api/legal/consent-status — Authenticated: check if user has accepted
  fastify.get('/consent-status', { preHandler: [authenticate] }, async (request) => {
    const user = await prisma.user.findUnique({
      where: { id: request.user.userId },
      select: { cguAcceptedAt: true, privacyAcceptedAt: true },
    });
    return {
      cguAccepted: !!user?.cguAcceptedAt,
      privacyAccepted: !!user?.privacyAcceptedAt,
      cguAcceptedAt: user?.cguAcceptedAt,
      privacyAcceptedAt: user?.privacyAcceptedAt,
    };
  });
}

// ---------------------------------------------------------------------------
// CGU Content
// ---------------------------------------------------------------------------
const CGU_CONTENT = `
# CONDITIONS GENERALES D'UTILISATION
## Plateforme GO CONTROLE — Version 1.0 du 01/03/2026

---

### ARTICLE 1 — OBJET ET CHAMP D'APPLICATION

Les presentes Conditions Generales d'Utilisation (ci-apres « CGU ») regissent l'acces et l'utilisation de la plateforme GO CONTROLE (ci-apres « la Plateforme »), outil professionnel de surveillance et d'analyse de communications electroniques.

**L'utilisation de la Plateforme est STRICTEMENT RESERVEE aux :**
- Services de police judiciaire et administrative dument habilites
- Magistrats du parquet et de l'instruction dans le cadre de procedures judiciaires
- Services de renseignement autorises par la loi
- Officiers de police judiciaire agissant sous commission rogatoire
- Personnels habilites des services d'enquete

**Toute utilisation en dehors de ce cadre constitue une infraction penale.**

### ARTICLE 2 — CADRE LEGAL

L'utilisation de la Plateforme s'inscrit exclusivement dans le cadre des dispositions suivantes :

**2.1 Code de procedure penale :**
- Articles 100 a 100-7 : Interceptions de correspondances emises par la voie des telecommunications
- Articles 230-32 a 230-44 : Geolocalisation
- Article 706-95-20 : Technique speciale d'enquete (captation de donnees informatiques)

**2.2 Code de la securite interieure :**
- Articles L.851-1 a L.851-7 : Acces aux donnees de connexion
- Articles L.852-1 a L.852-2 : Interceptions de securite
- Article L.853-2 : Captation de donnees informatiques

**2.3 Reglement General sur la Protection des Donnees (RGPD) :**
- Article 6.1.e : Traitement necessaire a l'execution d'une mission d'interet public
- Article 9.2.g : Motifs d'interet public important
- Article 23 : Limitations des droits des personnes concernees

**2.4 Loi Informatique et Libertes (LIL) :**
- Article 31 : Traitements de donnees a caractere personnel mis en oeuvre pour le compte de l'Etat
- Articles 87 a 98 : Traitements en matiere penale

### ARTICLE 3 — CONDITIONS D'ACCES

**3.1 Habilitation prealable :**
Tout utilisateur doit justifier d'une habilitation delivree par l'autorite competente. Les identifiants sont personnels, incessibles et non transmissibles.

**3.2 Authentification :**
L'acces est soumis a une authentification forte. Tout partage d'identifiants est interdit et constitue une faute grave.

**3.3 Traçabilite :**
L'ensemble des actions effectuees sur la Plateforme sont journalisees de maniere non repudiable (horodatage, identite de l'operateur, nature de l'action, cibles concernees).

### ARTICLE 4 — OBLIGATIONS DE L'UTILISATEUR

L'utilisateur s'engage a :

**4.1 Utilisation licite :**
- N'utiliser la Plateforme que dans le cadre d'une procedure judiciaire ou administrative reguliere
- Disposer de l'autorisation prealable requise (commission rogatoire, autorisation CNCTR, requisition judiciaire)
- Respecter strictement le perimetre de l'autorisation accordee (personnes ciblees, duree, nature des donnees)

**4.2 Proportionnalite :**
- Ne collecter que les donnees strictement necessaires a l'enquete
- Limiter la duree de surveillance au strict necessaire
- Cesser immediatement la surveillance a l'expiration de l'autorisation

**4.3 Confidentialite :**
- Respecter le secret de l'enquete et de l'instruction (art. 11 CPP)
- Ne pas divulguer les informations obtenues en dehors du cadre autorise
- Signaler immediatement toute compromission de ses identifiants

**4.4 Integrite des donnees :**
- Ne pas modifier, alterer ou supprimer les donnees collectees
- Garantir la chaine de preuve (chain of custody)
- Documenter toute operation effectuee

### ARTICLE 5 — INTERDICTIONS ABSOLUES

Il est FORMELLEMENT INTERDIT de :

- Utiliser la Plateforme a des fins personnelles, commerciales ou de renseignement economique prive
- Surveiller des personnes sans autorisation judiciaire ou administrative valide
- Surveiller des avocats, journalistes, parlementaires sans autorisation specifique renforcee
- Exfiltrer des donnees hors du systeme d'information securise
- Contourner les mecanismes de securite ou de traçabilite
- Utiliser les donnees collectees a d'autres fins que celles de la procedure
- Conserver les donnees au-dela des delais legaux de retention

**Toute violation expose l'utilisateur a :**
- Des poursuites penales (art. 226-1 et suivants du Code penal — atteinte a la vie privee : 1 an d'emprisonnement, 45 000€ d'amende)
- Des poursuites penales (art. 323-1 et suivants du Code penal — atteinte aux systemes de traitement automatise de donnees)
- Des sanctions disciplinaires pouvant aller jusqu'a la revocation
- La responsabilite civile pour prejudice cause aux personnes surveillees

### ARTICLE 6 — DONNEES COLLECTEES

La Plateforme est susceptible de collecter les categories de donnees suivantes, dans la limite de l'autorisation accordee :

- Donnees de presence et de connexion (horaires, frequence, duree)
- Metadonnees de communications (expediteur, destinataire, horodatage)
- Contenu des messages textuels
- Fichiers multimedia echanges (images, videos, documents, enregistrements audio)
- Donnees de geolocalisation partagees
- Historique d'appels (type, duree, statut)
- Activite dans les groupes de discussion
- Modifications de profil

### ARTICLE 7 — DUREE DE CONSERVATION

**7.1 Donnees d'enquete :**
Les donnees sont conservees conformement aux dispositions du Code de procedure penale :
- Procedure d'instruction : jusqu'a la decision definitive
- Enquete preliminaire : duree de la prescription de l'action publique
- Renseignement : delais fixes par la CNCTR

**7.2 Journaux d'activite :**
Les traces d'utilisation de la Plateforme sont conservees pendant 3 ans minimum.

**7.3 Destruction :**
A l'issue des delais de conservation, les donnees sont detruites de maniere securisee et irreversible. Un proces-verbal de destruction est etabli.

### ARTICLE 8 — RESPONSABILITE

**8.1** L'operateur est personnellement responsable de l'utilisation qu'il fait de la Plateforme et des donnees qu'il collecte.

**8.2** L'employeur (service, direction) est co-responsable du traitement au sens du RGPD et s'assure de la formation et de l'habilitation de ses agents.

**8.3** La Plateforme est fournie « en l'etat ». L'editeur ne garantit pas l'exhaustivite ou l'exactitude des donnees collectees.

### ARTICLE 9 — CONTROLE ET AUDIT

L'utilisation de la Plateforme est soumise au controle :
- De la Commission Nationale de Controle des Techniques de Renseignement (CNCTR)
- De l'autorite judiciaire competente
- Du Delegue a la Protection des Donnees (DPO) du service
- De l'Inspection Generale competente

Des audits inopines peuvent etre realises a tout moment.

### ARTICLE 10 — MODIFICATION DES CGU

Les presentes CGU peuvent etre modifiees a tout moment. Les utilisateurs seront informes de toute modification et devront renouveler leur acceptation.

### ARTICLE 11 — DROIT APPLICABLE

Les presentes CGU sont soumises au droit francais. Tout litige releve de la competence exclusive des juridictions francaises.

---

**En utilisant cette Plateforme, vous attestez avoir pris connaissance des presentes CGU, disposer de l'habilitation requise et vous engagez a les respecter integralement.**
`;

// ---------------------------------------------------------------------------
// Privacy Policy Content
// ---------------------------------------------------------------------------
const PRIVACY_CONTENT = `
# POLITIQUE DE CONFIDENTIALITE ET DE PROTECTION DES DONNEES
## Plateforme GO CONTROLE — Version 1.0 du 01/03/2026

---

### 1. RESPONSABLE DU TRAITEMENT

Le responsable du traitement est le service utilisateur de la Plateforme GO CONTROLE, represente par son directeur ou chef de service.

Contact DPO : dpo@gocontrole.gouv.fr

### 2. FINALITES DU TRAITEMENT

Les donnees sont traitees exclusivement pour les finalites suivantes :
- **Prevention et detection des infractions penales** (art. 6.1.e RGPD)
- **Execution de missions de service public** dans le cadre judiciaire et administratif
- **Renseignement** dans le cadre des autorisations delivrees par le Premier ministre apres avis de la CNCTR

### 3. BASE LEGALE

Le traitement repose sur :
- **L'execution d'une mission d'interet public** (art. 6.1.e RGPD)
- **Les obligations legales** du responsable du traitement (art. 6.1.c RGPD)
- Les dispositions specifiques du Code de procedure penale et du Code de la securite interieure

### 4. CATEGORIES DE DONNEES TRAITEES

**4.1 Donnees des personnes surveillees :**
- Identifiants de communication (numeros, JID WhatsApp)
- Donnees de presence et de connexion
- Contenu des communications (messages, medias, appels)
- Metadonnees (horodatage, participants, geolocalisation)
- Donnees comportementales (patterns d'activite)

**4.2 Donnees des utilisateurs de la Plateforme :**
- Identite (nom, prenom, email professionnel)
- Identifiants de connexion
- Journaux d'activite (actions effectuees, horodatage)
- Donnees de session (IP, user-agent)

### 5. DESTINATAIRES DES DONNEES

Les donnees sont accessibles exclusivement :
- Aux utilisateurs habilites de la Plateforme
- A l'autorite judiciaire competente
- Aux organes de controle (CNCTR, DPO, Inspection Generale)

**Aucun transfert de donnees vers un pays tiers n'est effectue.**

### 6. DUREE DE CONSERVATION

| Type de donnees | Duree de conservation |
|---|---|
| Donnees d'enquete judiciaire | Jusqu'a decision definitive + prescription |
| Donnees de renseignement | Selon autorisation CNCTR (max. fixe par la loi) |
| Journaux d'utilisation | 3 ans |
| Comptes utilisateurs | Duree de l'habilitation + 1 an |

### 7. SECURITE DES DONNEES

Les mesures de securite mises en oeuvre comprennent :
- Chiffrement des donnees en transit (TLS 1.3) et au repos (AES-256)
- Authentification forte des utilisateurs
- Journalisation non repudiable de toutes les actions
- Cloisonnement des acces par habilitation
- Sauvegardes chiffrees avec retention limitee
- Hebergement sur infrastructure securisee (SecNumCloud ou equivalent)

### 8. DROITS DES PERSONNES

**8.1 Personnes surveillees :**
Conformement aux articles 23 du RGPD et 70-21 du decret d'application de la LIL, les droits d'acces, de rectification, d'effacement et d'opposition des personnes surveillees peuvent etre **limites ou differes** afin de ne pas compromettre :
- La prevention ou la detection d'infractions penales
- Les enquetes ou poursuites en matiere penale
- La securite publique ou la securite nationale

Les personnes concernees peuvent exercer leurs droits aupres de la CNIL dans les conditions prevues par la loi.

**8.2 Utilisateurs de la Plateforme :**
Les utilisateurs disposent d'un droit d'acces et de rectification de leurs donnees personnelles aupres du DPO de leur service.

### 9. ANALYSE D'IMPACT (AIPD)

Une Analyse d'Impact relative a la Protection des Donnees (AIPD) a ete realisee conformement a l'article 35 du RGPD. Le document est disponible sur demande aupres du DPO.

### 10. SOUS-TRAITANCE

La Plateforme utilise les sous-traitants suivants, tous conformes au RGPD :
- Hebergement : Infrastructure dediee securisee
- Base de donnees : PostgreSQL (auto-heberge)
- Cache : Redis (auto-heberge)

Aucun sous-traitant extra-europeen n'est utilise.

### 11. INTEGRATION API PISTE

La Plateforme est connectee a l'API PISTE (Plateforme d'Intermediation des Services pour la Transformation de l'Etat), operee par l'AIFE (Agence pour l'Informatique Financiere de l'Etat).

Les donnees accessibles via PISTE sont des **donnees publiques** (BODACC, Registre du Commerce, donnees legales d'entreprises) et ne contiennent pas de donnees a caractere personnel sensible.

L'authentification a l'API PISTE est realisee via le protocole OAuth 2.0 (Client Credentials) conformement aux specifications de l'AIFE.

### 12. VIOLATION DE DONNEES

En cas de violation de donnees a caractere personnel, le responsable du traitement :
- Notifie la CNIL dans un delai de 72 heures (art. 33 RGPD)
- Informe les personnes concernees si le risque est eleve (art. 34 RGPD)
- Documente l'incident dans le registre des violations

### 13. CONTACT

Pour toute question relative a la protection des donnees :
- **DPO** : dpo@gocontrole.gouv.fr
- **CNIL** : www.cnil.fr — 3 Place de Fontenoy, 75007 Paris

---

**Derniere mise a jour : 01 mars 2026**
`;
