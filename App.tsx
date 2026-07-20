import React, { useState, useEffect, useRef } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TextInput,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
  ActivityIndicator,
  Alert,
  StatusBar,
  Linking,
  KeyboardAvoidingView,
  Platform,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  recupererArborescence,
  recupererContenuFichiersEnParallele,
  creerNouvelleBranche,
  commiterPlusieursFichiers,
  creerPullRequest,
  recupererWorkflows,
  declencherWorkflow,
  recupererDerniereExecutionBranche,
  recupererLogsErreurJob,
  ExecutionWorkflow
} from './src/services/github';
import {
  choisirFichiersNecessaires,
  modifierCodeAvecGemini,
  ModificationFichier
} from './src/services/gemini';

// ─── Clé de stockage de la configuration ─────────────────────────────────────
const CLE_STORAGE_CONFIG = '@remote_code_config';

// ─── Types locaux ─────────────────────────────────────────────────────────────
type OngletPrincipal = 'chat' | 'projet' | 'ci';

interface MessageChat {
  id: string;
  role: 'user' | 'ia' | 'systeme';
  texte: string;
  timestamp: Date;
}

// Représente une étape de la "pensée" de l'agent (pour l'indicateur de chargement)
type EtapeAgent = 'repos' | 'analyse' | 'telechargement' | 'generation' | 'idle';

// ─── Composant principal ──────────────────────────────────────────────────────
export default function App() {
  const [ongletActif, setOngletActif] = useState<OngletPrincipal>('chat');

  // Configuration
  const [tokenGithub, setTokenGithub] = useState('');
  const [cleGemini, setCleGemini] = useState('');
  const [proprietaire, setProprietaire] = useState('');
  const [nomDepot, setNomDepot] = useState('');
  const [brancheCible, setBrancheCible] = useState('main');
  const [afficherConfig, setAfficherConfig] = useState(false);

  // Arborescence du dépôt (chargée une seule fois au démarrage ou sur demande)
  const [arborescence, setArborescence] = useState<string[]>([]);
  const [arborescenceChargee, setArborescenceChargee] = useState(false);

  // Résultat du dernier cycle agent : fichiers lus + modifications générées
  const [derniersFilesCharges, setDerniersFilesCharges] = useState<Array<{ path: string; content: string }>>([]);
  const [modificationsIA, setModificationsIA] = useState<ModificationFichier[]>([]);
  const [fichierVisuActif, setFichierVisuActif] = useState('');
  const [modeVisu, setModeVisu] = useState<'original' | 'modifie'>('original');

  // Chat
  const [messagesChat, setMessagesChat] = useState<MessageChat[]>([]);
  const [saisieConsigne, setSaisieConsigne] = useState('');
  const scrollChatRef = useRef<ScrollView>(null);

  // Indicateur d'étape de l'agent (remplace le simple boolean chargement)
  const [etapeAgent, setEtapeAgent] = useState<EtapeAgent>('idle');

  // CI/CD
  const [workflows, setWorkflows] = useState<Array<{ id: number; name: string; path: string }>>([]);
  const [workflowSelectionne, setWorkflowSelectionne] = useState<string | number>('');
  const [brancheDerniereSoumission, setBrancheDerniereSoumission] = useState('');
  const [derniereExecution, setDerniereExecution] = useState<ExecutionWorkflow | null>(null);
  const [logsErreurCI, setLogsErreurCI] = useState('');
  const [surveillanceActive, setSurveillanceActive] = useState(false);
  const [urlPullRequest, setUrlPullRequest] = useState('');
  const intervalleSurveillance = useRef<NodeJS.Timeout | null>(null);

  // Overlay de chargement global (pour commit/PR)
  const [chargementGlobal, setChargementGlobal] = useState(false);
  const [etapeChargement, setEtapeChargement] = useState('');

  useEffect(() => {
    chargerConfiguration();
    return () => {
      if (intervalleSurveillance.current) clearInterval(intervalleSurveillance.current);
    };
  }, []);

  // Scroll automatique vers le bas du chat à chaque nouveau message
  useEffect(() => {
    if (messagesChat.length > 0) {
      setTimeout(() => scrollChatRef.current?.scrollToEnd({ animated: true }), 100);
    }
  }, [messagesChat]);

  // ─── CONFIGURATION ──────────────────────────────────────────────────────────

  const chargerConfiguration = async () => {
    try {
      const json = await AsyncStorage.getItem(CLE_STORAGE_CONFIG);
      if (json) {
        const c = JSON.parse(json);
        setTokenGithub(c.tokenGithub || '');
        setCleGemini(c.cleGemini || '');
        setProprietaire(c.proprietaire || '');
        setNomDepot(c.nomDepot || '');
        setBrancheCible(c.brancheCible || 'main');
        if (c.tokenGithub && c.cleGemini && c.proprietaire && c.nomDepot) {
          setAfficherConfig(false);
          // Charger l'arborescence automatiquement au démarrage si configuré
          chargerArborescenceAuDemarrage(c.tokenGithub, c.proprietaire, c.nomDepot, c.brancheCible || 'main');
        } else {
          setAfficherConfig(true);
        }
      } else {
        setAfficherConfig(true);
      }
    } catch {
      setAfficherConfig(true);
    }
  };

  const chargerArborescenceAuDemarrage = async (
    token: string, owner: string, repo: string, branche: string
  ) => {
    try {
      const arbre = await recupererArborescence(token, owner, repo, branche);
      setArborescence(arbre);
      setArborescenceChargee(true);
      const wf = await recupererWorkflows(token, owner, repo);
      setWorkflows(wf);
      if (wf.length > 0) setWorkflowSelectionne(wf[0].id);
    } catch {
      // Silencieux au démarrage — l'utilisateur peut réessayer depuis le chat
    }
  };

  const sauvegarderConfiguration = async () => {
    try {
      await AsyncStorage.setItem(CLE_STORAGE_CONFIG, JSON.stringify({
        tokenGithub, cleGemini, proprietaire, nomDepot, brancheCible
      }));
      setAfficherConfig(false);
      setArborescenceChargee(false);
      chargerArborescenceAuDemarrage(tokenGithub, proprietaire, nomDepot, brancheCible);
      Alert.alert('✅ Enregistré', 'Configuration sauvegardée. Le dépôt va être chargé...');
    } catch {
      Alert.alert('Erreur', 'Impossible de sauvegarder la configuration.');
    }
  };

  // ─── MODE AGENT AUTONOME — Cœur de l'application ────────────────────────────
  //
  // Flux complet en 3 étapes :
  //   1. Gemini analyse l'arborescence et choisit les fichiers nécessaires
  //   2. L'app télécharge ces fichiers depuis GitHub
  //   3. Gemini génère les modifications à appliquer
  //
  const gererEnvoiConsigne = async () => {
    const consigne = saisieConsigne.trim();
    if (!consigne) return;
    if (!tokenGithub || !cleGemini || !proprietaire || !nomDepot) {
      Alert.alert('Non configuré', 'Ouvrez la configuration ⚙️ et renseignez vos accès.');
      setAfficherConfig(true);
      return;
    }

    // Ajouter le message utilisateur dans l'historique du chat
    const msgUser: MessageChat = {
      id: Date.now().toString(),
      role: 'user',
      texte: consigne,
      timestamp: new Date()
    };
    setMessagesChat(prev => [...prev, msgUser]);
    setSaisieConsigne('');
    Keyboard.dismiss();

    try {
      // ── Étape 0 : Charger l'arborescence si elle n'est pas encore disponible
      let arbreActuel = arborescence;
      if (!arborescenceChargee || arborescence.length === 0) {
        setEtapeAgent('repos');
        ajouterMessageSysteme('🔍 Lecture de l\'arborescence du dépôt...');
        arbreActuel = await recupererArborescence(tokenGithub, proprietaire, nomDepot, brancheCible);
        setArborescence(arbreActuel);
        setArborescenceChargee(true);
      }

      // ── Étape 1 : Gemini choisit les fichiers nécessaires
      setEtapeAgent('analyse');
      ajouterMessageSysteme(`🧠 Gemini analyse votre demande et identifie les fichiers pertinents dans ${arbreActuel.length} fichiers...`);

      const cheminsFichiersChoisis = await choisirFichiersNecessaires(cleGemini, arbreActuel, consigne);

      if (cheminsFichiersChoisis.length === 0) {
        ajouterMessageIA('Je n\'ai pas trouvé de fichiers pertinents pour cette demande dans le dépôt. Reformulez ou précisez votre consigne.');
        setEtapeAgent('idle');
        return;
      }

      ajouterMessageSysteme(`📋 ${cheminsFichiersChoisis.length} fichier(s) sélectionné(s) : ${cheminsFichiersChoisis.map(c => `\`${c.split('/').pop()}\``).join(', ')}`);

      // ── Étape 2 : Télécharger les fichiers choisis depuis GitHub
      setEtapeAgent('telechargement');
      ajouterMessageSysteme(`📥 Téléchargement de ${cheminsFichiersChoisis.length} fichier(s)...`);

      const fichiersCharges = await recupererContenuFichiersEnParallele(
        tokenGithub, proprietaire, nomDepot, cheminsFichiersChoisis, brancheCible
      );
      setDerniersFilesCharges(fichiersCharges);

      // ── Étape 3 : Gemini génère les modifications
      setEtapeAgent('generation');
      ajouterMessageSysteme('⚙️ Gemini génère les modifications du code...');

      const modifications = await modifierCodeAvecGemini(
        cleGemini, arbreActuel, fichiersCharges, consigne
      );

      setModificationsIA(modifications);
      setFichierVisuActif(modifications[0]?.path || '');
      setModeVisu('modifie');

      // Message de résumé pour l'utilisateur
      const resumeModifs = modifications.map(m =>
        `${m.action === 'CREATE' ? '🆕' : '✏️'} \`${m.path}\``
      ).join('\n');

      ajouterMessageIA(
        `J'ai effectué **${modifications.length}** modification(s) :\n\n${resumeModifs}\n\nVisualisez le code dans l'onglet **Projet** 📁, puis cliquez sur **Commiter** pour pousser sur GitHub.`
      );

    } catch (erreur: any) {
      ajouterMessageIA(`❌ Erreur : ${erreur.message || 'Une erreur inattendue s\'est produite.'}`);
    } finally {
      setEtapeAgent('idle');
    }
  };

  // ─── HELPERS MESSAGES CHAT ───────────────────────────────────────────────────

  const ajouterMessageSysteme = (texte: string) => {
    setMessagesChat(prev => [...prev, {
      id: `sys-${Date.now()}-${Math.random()}`,
      role: 'systeme',
      texte,
      timestamp: new Date()
    }]);
  };

  const ajouterMessageIA = (texte: string) => {
    setMessagesChat(prev => [...prev, {
      id: `ia-${Date.now()}`,
      role: 'ia',
      texte,
      timestamp: new Date()
    }]);
  };

  // ─── COMMIT + PR ────────────────────────────────────────────────────────────

  const gererSoumissionGitHub = async () => {
    if (modificationsIA.length === 0) return;
    setChargementGlobal(true);
    setEtapeChargement('Création de la branche...');
    const ts = Math.floor(Date.now() / 1000);
    const nouvelleBranche = `feature/remote-ia-${ts}`;
    try {
      await creerNouvelleBranche(tokenGithub, proprietaire, nomDepot, brancheCible, nouvelleBranche);
      setEtapeChargement('Commit atomique multi-fichiers...');
      await commiterPlusieursFichiers(
        tokenGithub, proprietaire, nomDepot,
        modificationsIA.map(m => ({ path: m.path, content: m.content })),
        nouvelleBranche,
        `[IA Remote] ${modificationsIA.length} fichier(s) modifié(s)`
      );
      setEtapeChargement('Ouverture de la Pull Request...');
      const prUrl = await creerPullRequest(
        tokenGithub, proprietaire, nomDepot,
        `[IA] Modifie ${modificationsIA.length} fichier(s)`,
        `Modifications via IA Remote.\n\n**Fichiers :** ${modificationsIA.map(m => `\`${m.path}\``).join(', ')}`,
        nouvelleBranche, brancheCible
      );
      setUrlPullRequest(prUrl);
      setBrancheDerniereSoumission(nouvelleBranche);
      setOngletActif('ci');
      ajouterMessageSysteme(`🚀 Code poussé sur \`${nouvelleBranche}\`. Allez sur CI/CD pour lancer les tests !`);
    } catch (e: any) {
      Alert.alert('Erreur de validation', e.message);
    } finally {
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  // ─── CI / CD ────────────────────────────────────────────────────────────────

  const gererDeclenchementCI = async () => {
    if (!brancheDerniereSoumission || !workflowSelectionne) return;
    setChargementGlobal(true);
    setEtapeChargement('Déclenchement du workflow...');
    setLogsErreurCI('');
    setDerniereExecution(null);
    try {
      await declencherWorkflow(tokenGithub, proprietaire, nomDepot, workflowSelectionne, brancheDerniereSoumission);
      setChargementGlobal(false);
      setEtapeChargement('');
      lancerSurveillanceCI();
    } catch (e: any) {
      Alert.alert('Erreur', e.message);
      setChargementGlobal(false);
      setEtapeChargement('');
    }
  };

  const lancerSurveillanceCI = () => {
    if (intervalleSurveillance.current) clearInterval(intervalleSurveillance.current);
    setSurveillanceActive(true);
    verifierStatutCI();
    intervalleSurveillance.current = setInterval(verifierStatutCI, 6000);
  };

  const verifierStatutCI = async () => {
    const run = await recupererDerniereExecutionBranche(tokenGithub, proprietaire, nomDepot, brancheDerniereSoumission);
    if (!run) return;
    setDerniereExecution(run);
    if (run.status === 'completed') {
      if (intervalleSurveillance.current) clearInterval(intervalleSurveillance.current);
      setSurveillanceActive(false);
      if (run.conclusion === 'failure') {
        const logs = await recupererLogsErreurJob(tokenGithub, proprietaire, nomDepot, run.id);
        setLogsErreurCI(logs);
      }
    }
  };

  // Injecte les logs d'erreur CI directement dans le chat pour que Gemini corrige
  const gererAutoCorrection = () => {
    if (!logsErreurCI) return;
    setSaisieConsigne(`Le build a échoué. Voici le rapport d'erreur :\n---\n${logsErreurCI}\n---\nCorrige le code pour résoudre ce problème.`);
    setLogsErreurCI('');
    setDerniereExecution(null);
    setOngletActif('chat');
  };

  // ─── RENDU ──────────────────────────────────────────────────────────────────

  const estEnChargement = etapeAgent !== 'idle';

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#07080F" />

      {/* ── Modal de Configuration ── */}
      {afficherConfig && (
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.modalConfig}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.modalConfigContent} keyboardShouldPersistTaps="handled">
              <View style={styles.modalConfigEntete}>
                <Text style={styles.modalTitre}>⚙️ Configuration</Text>
                <TouchableOpacity onPress={() => setAfficherConfig(false)} style={styles.boutonFermer}>
                  <Text style={styles.boutonFermerTexte}>✕</Text>
                </TouchableOpacity>
              </View>

              <Text style={styles.labelGroupe}>GEMINI</Text>
              <TextInput style={styles.inputConfig} placeholder="Clé API Gemini" placeholderTextColor="#3F4860" secureTextEntry value={cleGemini} onChangeText={setCleGemini} />

              <Text style={styles.labelGroupe}>GITHUB</Text>
              <TextInput style={styles.inputConfig} placeholder="Personal Access Token" placeholderTextColor="#3F4860" secureTextEntry value={tokenGithub} onChangeText={setTokenGithub} />
              <View style={styles.rangeeDoubleInput}>
                <TextInput style={[styles.inputConfig, { flex: 1, marginRight: 8 }]} placeholder="Utilisateur" placeholderTextColor="#3F4860" value={proprietaire} onChangeText={setProprietaire} />
                <TextInput style={[styles.inputConfig, { flex: 1 }]} placeholder="Dépôt" placeholderTextColor="#3F4860" value={nomDepot} onChangeText={setNomDepot} />
              </View>
              <TextInput style={styles.inputConfig} placeholder="Branche (ex: main)" placeholderTextColor="#3F4860" value={brancheCible} onChangeText={setBrancheCible} />

              <TouchableOpacity style={styles.boutonPrimaire} onPress={sauvegarderConfiguration}>
                <Text style={styles.boutonPrimaireTexte}>💾 Sauvegarder et connecter</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      )}

      {/* ── Application principale ── */}
      <View style={styles.conteneur}>

        {/* En-tête global */}
        <View style={styles.enTete}>
          <View style={styles.enTeteGauche}>
            <View style={styles.logoBadge}>
              <Text style={styles.logoEmoji}>🤖</Text>
            </View>
            <View>
              <Text style={styles.titreEnTete}>IA Code Remote</Text>
              <Text style={styles.sousTitreEnTete}>
                {proprietaire && nomDepot
                  ? `${proprietaire}/${nomDepot} · ${arborescence.length} fichiers`
                  : 'Non configuré'}
              </Text>
            </View>
          </View>
          <View style={styles.enTeteDroite}>
            {/* Indicateur que l'arborescence est prête */}
            {arborescenceChargee && (
              <View style={styles.pastilleVerte} />
            )}
            <TouchableOpacity style={styles.boutonConfigEnTete} onPress={() => setAfficherConfig(true)}>
              <Text style={styles.iconConfig}>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* ── Corps principal ── */}
        <View style={styles.corps}>
          {ongletActif === 'chat' && (
            <EcranChat
              messages={messagesChat}
              saisie={saisieConsigne}
              setSaisie={setSaisieConsigne}
              onEnvoyer={gererEnvoiConsigne}
              etapeAgent={etapeAgent}
              scrollRef={scrollChatRef}
              nomDepot={`${proprietaire}/${nomDepot}`}
              arborescenceChargee={arborescenceChargee}
              nbFichiers={arborescence.length}
            />
          )}

          {ongletActif === 'projet' && (
            <EcranProjet
              fichiersCharges={derniersFilesCharges}
              modificationsIA={modificationsIA}
              fichierVisuActif={fichierVisuActif}
              setFichierVisuActif={setFichierVisuActif}
              modeVisu={modeVisu}
              setModeVisu={setModeVisu}
              onCommiter={gererSoumissionGitHub}
              urlPullRequest={urlPullRequest}
            />
          )}

          {ongletActif === 'ci' && (
            <EcranCI
              brancheSoumission={brancheDerniereSoumission}
              workflows={workflows}
              workflowSelectionne={workflowSelectionne}
              setWorkflowSelectionne={setWorkflowSelectionne}
              derniereExecution={derniereExecution}
              surveillanceActive={surveillanceActive}
              logsErreurCI={logsErreurCI}
              urlPullRequest={urlPullRequest}
              onDeclencher={gererDeclenchementCI}
              onAutoCorrection={gererAutoCorrection}
              onOuvrirPR={() => urlPullRequest && Linking.openURL(urlPullRequest)}
              onOuvrirRun={() => derniereExecution && Linking.openURL(derniereExecution.html_url)}
            />
          )}
        </View>

        {/* ── Barre d'onglets en bas ── */}
        <View style={styles.barreOnglets}>
          <BoutonOnglet icone="💬" label="Chat IA" actif={ongletActif === 'chat'} onPress={() => setOngletActif('chat')} />
          <BoutonOnglet
            icone="📁"
            label="Projet"
            actif={ongletActif === 'projet'}
            onPress={() => setOngletActif('projet')}
            badge={modificationsIA.length > 0 ? modificationsIA.length.toString() : undefined}
            couleurBadge="#10B981"
          />
          <BoutonOnglet
            icone="🚦"
            label="CI/CD"
            actif={ongletActif === 'ci'}
            onPress={() => setOngletActif('ci')}
            badge={derniereExecution?.conclusion === 'failure' ? '!' : undefined}
            couleurBadge="#EF4444"
          />
        </View>
      </View>

      {/* Overlay de chargement global (commit) */}
      {chargementGlobal && (
        <View style={styles.overlayChargement}>
          <View style={styles.carteChargement}>
            <ActivityIndicator size="large" color="#6366F1" />
            <Text style={styles.texteChargement}>{etapeChargement}</Text>
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Composant réutilisable : bouton d'onglet ─────────────────────────────────
function BoutonOnglet({ icone, label, actif, onPress, badge, couleurBadge }: {
  icone: string; label: string; actif: boolean;
  onPress: () => void; badge?: string; couleurBadge?: string;
}) {
  return (
    <TouchableOpacity
      style={[styles.boutonOnglet, actif && styles.boutonOngletActif]}
      onPress={onPress}
    >
      <Text style={styles.ongletEmoji}>{icone}</Text>
      <Text style={[styles.ongletLabel, actif && styles.ongletLabelActif]}>{label}</Text>
      {badge && (
        <View style={[styles.badgeOnglet, { backgroundColor: couleurBadge || '#6366F1' }]}>
          <Text style={styles.badgeOngletTexte}>{badge}</Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN CHAT ──────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranChat({ messages, saisie, setSaisie, onEnvoyer, etapeAgent, scrollRef, nomDepot, arborescenceChargee, nbFichiers }: any) {
  const estEnChargement = etapeAgent !== 'idle';

  // Texte décrivant l'étape courante de l'agent pour l'indicateur de frappe
  const texteEtape: Record<string, string> = {
    repos: 'Lecture du dépôt GitHub...',
    analyse: 'Analyse et sélection des fichiers pertinents...',
    telechargement: 'Téléchargement des fichiers nécessaires...',
    generation: 'Génération des modifications du code...',
  };

  return (
    // Le View flex:1 s'adapte quand softwareKeyboardLayoutMode="resize" pousse la vue vers le haut
    <View style={{ flex: 1 }}>

      {/* ── Zone de saisie EN HAUT — toujours visible, jamais masquée par le clavier ── */}
      <View style={styles.zoneInputChatHaut}>
        <View style={styles.inputChatWrapper}>
          <TextInput
            style={styles.inputChat}
            placeholder="Que souhaitez-vous modifier dans le code ?"
            placeholderTextColor="#3F4860"
            value={saisie}
            onChangeText={setSaisie}
            multiline
            maxHeight={120}
            returnKeyType="default"
            blurOnSubmit={false}
          />
          <TouchableOpacity
            style={[styles.boutonEnvoyer, (!saisie.trim() || estEnChargement) && styles.boutonEnvoyerDesactive]}
            onPress={onEnvoyer}
            disabled={!saisie.trim() || estEnChargement}
          >
            <Text style={styles.boutonEnvoyerTexte}>↑</Text>
          </TouchableOpacity>
        </View>
        {/* Bandeau d'état du dépôt sous l'input */}
        <View style={arborescenceChargee ? styles.bandeauInfo : styles.bandeauAvertissement}>
          <Text style={arborescenceChargee ? styles.bandeauInfoTexte : styles.bandeauAvertissementTexte}>
            {arborescenceChargee
              ? `✅ ${nomDepot} · ${nbFichiers} fichiers indexés`
              : '⚠️ Dépôt non chargé — configurez vos accès GitHub ⚙️'}
          </Text>
        </View>
      </View>

      {/* ── Historique de la conversation — défile vers le bas ── */}
      <ScrollView
        ref={scrollRef}
        style={styles.scrollChat}
        contentContainerStyle={styles.contentScrollChat}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
      >
        {messages.length === 0 ? (
          <View style={styles.etatVideChat}>
            <Text style={styles.etatVideEmoji}>🤖</Text>
            <Text style={styles.etatVideTitre}>Agent IA prêt</Text>
            <Text style={styles.etatVideSousTitre}>
              Décrivez la modification que vous souhaitez apporter à votre code.{'\n\n'}
              L'IA va automatiquement analyser votre dépôt, choisir les bons fichiers et générer les modifications.
            </Text>
            <View style={styles.listePhrases}>
              {[
                '"Ajoute une validation d\'email au formulaire de connexion"',
                '"Corrige le bug de navigation sur la page des détails"',
                '"Crée un composant bouton réutilisable avec support de chargement"',
              ].map((ex, i) => (
                <Text key={i} style={styles.exPhrase}>{ex}</Text>
              ))}
            </View>
          </View>
        ) : (
          messages.map((msg: MessageChat) => {
            // Messages système : petits et centrés (logs de progression de l'agent)
            if (msg.role === 'systeme') {
              return (
                <View key={msg.id} style={styles.messageSysteme}>
                  <Text style={styles.texteMessageSysteme}>{msg.texte}</Text>
                </View>
              );
            }
            // Bulles normales : utilisateur à droite, IA à gauche
            return (
              <View key={msg.id} style={[
                styles.bulleChat,
                msg.role === 'user' ? styles.bulleChatUser : styles.bulleChatIA
              ]}>
                {msg.role === 'ia' && <Text style={styles.avatarIA}>🤖</Text>}
                <View style={[
                  styles.contentenBulle,
                  msg.role === 'user' ? styles.contentenBulleUser : styles.contentenBulleIA
                ]}>
                  <Text style={styles.texteMessage}>{msg.texte}</Text>
                  <Text style={styles.timestampMessage}>
                    {msg.timestamp.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                  </Text>
                </View>
              </View>
            );
          })
        )}

        {/* Indicateur de frappe de l'agent avec étape courante */}
        {estEnChargement && (
          <View style={[styles.bulleChat, styles.bulleChatIA]}>
            <Text style={styles.avatarIA}>🤖</Text>
            <View style={styles.indicateurTyping}>
              <ActivityIndicator size="small" color="#6366F1" />
              <Text style={styles.texteTyping}>{texteEtape[etapeAgent] || 'Traitement...'}</Text>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}



// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN PROJET (Visualisation des modifications) ──────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranProjet({ fichiersCharges, modificationsIA, fichierVisuActif, setFichierVisuActif, modeVisu, setModeVisu, onCommiter, urlPullRequest }: any) {
  // Tous les chemins disponibles pour la navigation (union des fichiers lus et des nouvelles créations)
  const tousChemin: string[] = Array.from(new Set([
    ...fichiersCharges.map((f: any) => f.path),
    ...modificationsIA.map((m: any) => m.path)
  ]));

  const obtenirCodeOriginal = (chemin: string) =>
    fichiersCharges.find((f: any) => f.path === chemin)?.content || '// Fichier non existant (création)';

  const obtenirCodeModifie = (chemin: string) =>
    modificationsIA.find((m: any) => m.path === chemin)?.content || obtenirCodeOriginal(chemin);

  const estModifie = (chemin: string) => modificationsIA.some((m: any) => m.path === chemin);
  const estNouveau = (chemin: string) => !fichiersCharges.some((f: any) => f.path === chemin) && estModifie(chemin);

  if (tousChemin.length === 0) {
    return (
      <View style={styles.etatVide}>
        <Text style={styles.etatVideEmoji}>📁</Text>
        <Text style={styles.etatVideTitre}>Aucune modification en attente</Text>
        <Text style={styles.etatVideSousTitre}>
          Posez une question à l'IA dans le Chat pour générer des modifications à visualiser ici.
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.ecranContenu}>
      {/* Barre de mode : Original / Modifié */}
      <View style={styles.barreOutils}>
        <Text style={styles.titreBarreOutils}>Comparaison du code</Text>
        <View style={styles.badgesMode}>
          <TouchableOpacity style={[styles.badgeMode, modeVisu === 'original' && styles.badgeModeActif]} onPress={() => setModeVisu('original')}>
            <Text style={[styles.badgeModeTexte, modeVisu === 'original' && styles.badgeModeTexteActif]}>Original</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.badgeMode, modeVisu === 'modifie' && styles.badgeModeActifVert]} onPress={() => setModeVisu('modifie')}>
            <Text style={[styles.badgeModeTexte, modeVisu === 'modifie' && { color: '#10B981' }]}>Modifié ✨</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Sélecteur de fichier horizontal */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.scrollSelecteurFichier}>
        {tousChemin.map((chemin: string, i: number) => (
          <TouchableOpacity
            key={i}
            style={[styles.pucheSelecteurFichier, fichierVisuActif === chemin && styles.pucheSelecteurFichierActif]}
            onPress={() => setFichierVisuActif(chemin)}
          >
            <Text style={[styles.pucheSelecteurFichierTexte, fichierVisuActif === chemin && { color: '#F8FAFC' }]}>
              {estNouveau(chemin) ? '🆕 ' : estModifie(chemin) ? '✏️ ' : ''}
              {chemin.split('/').pop()}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Zone de code (scroll horizontal + vertical) */}
      <ScrollView style={styles.zoneCode} horizontal>
        <ScrollView>
          <Text style={styles.codeMonospace}>
            {modeVisu === 'original'
              ? obtenirCodeOriginal(fichierVisuActif)
              : obtenirCodeModifie(fichierVisuActif)}
          </Text>
        </ScrollView>
      </ScrollView>

      {/* Bouton de commit */}
      {modificationsIA.length > 0 && (
        <TouchableOpacity style={styles.boutonCommit} onPress={onCommiter}>
          <Text style={styles.boutonCommitTexte}>
            🚀 Commiter {modificationsIA.length} fichier(s) sur GitHub
          </Text>
        </TouchableOpacity>
      )}

      {urlPullRequest !== '' && (
        <TouchableOpacity style={styles.boutonPR} onPress={() => Linking.openURL(urlPullRequest)}>
          <Text style={styles.boutonPRTexte}>🔗 Voir la Pull Request</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── ÉCRAN CI/CD ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
function EcranCI({ brancheSoumission, workflows, workflowSelectionne, setWorkflowSelectionne, derniereExecution, surveillanceActive, logsErreurCI, urlPullRequest, onDeclencher, onAutoCorrection, onOuvrirPR, onOuvrirRun }: any) {
  const getIconeStatut = () => {
    if (!derniereExecution) return '⏳';
    if (surveillanceActive || derniereExecution.status !== 'completed') return '🟡';
    return derniereExecution.conclusion === 'success' ? '🟢' : '🔴';
  };

  const getTexteStatut = () => {
    if (!derniereExecution) return 'En attente de déclenchement';
    if (derniereExecution.status === 'queued') return 'En file d\'attente...';
    if (derniereExecution.status === 'in_progress') return 'Tests en cours...';
    if (derniereExecution.conclusion === 'success') return 'Tous les tests passent ✅';
    if (derniereExecution.conclusion === 'failure') return 'Échec du build ❌';
    return `Terminé : ${derniereExecution.conclusion}`;
  };

  const getCouleurCarteStatut = () => {
    if (!derniereExecution) return C.surface;
    if (surveillanceActive || derniereExecution.status !== 'completed') return '#1C1200';
    return derniereExecution.conclusion === 'success' ? '#0A200F' : '#200A0A';
  };

  return (
    <ScrollView style={styles.ecranContenu} contentContainerStyle={{ padding: 16 }}>
      {!brancheSoumission ? (
        <View style={styles.etatVide}>
          <Text style={styles.etatVideEmoji}>🚦</Text>
          <Text style={styles.etatVideTitre}>Aucune branche poussée</Text>
          <Text style={styles.etatVideSousTitre}>
            Demandez une modification dans le Chat, prévisualisez dans Projet et commitez d'abord.
          </Text>
        </View>
      ) : (
        <>
          {/* Branche ciblée */}
          <View style={styles.carteCI}>
            <Text style={styles.labelCarteCI}>BRANCHE TESTÉE</Text>
            <Text style={styles.valeurCarteCI}>🌿 {brancheSoumission}</Text>
          </View>

          {/* Statut de l'exécution */}
          <View style={[styles.carteCI, { backgroundColor: getCouleurCarteStatut() }]}>
            <View style={styles.ligneStatutCI}>
              <Text style={styles.iconStatutCI}>{getIconeStatut()}</Text>
              <View style={{ flex: 1 }}>
                <Text style={styles.texteStatutCI}>{getTexteStatut()}</Text>
                {derniereExecution?.name && (
                  <Text style={styles.nomWorkflowCI}>{derniereExecution.name}</Text>
                )}
              </View>
              {(surveillanceActive || (derniereExecution && derniereExecution.status !== 'completed')) && (
                <ActivityIndicator size="small" color="#FCD34D" />
              )}
            </View>
            {derniereExecution && (
              <TouchableOpacity style={styles.lienCI} onPress={onOuvrirRun}>
                <Text style={styles.lienCITexte}>Voir l'exécution sur GitHub →</Text>
              </TouchableOpacity>
            )}
          </View>

          {/* Workflow + bouton déclenchement */}
          {!surveillanceActive && (
            <View style={styles.carteCI}>
              <Text style={styles.labelCarteCI}>WORKFLOW</Text>
              {workflows.length === 0 ? (
                <Text style={styles.texteAucunWorkflow}>Aucun workflow trouvé (.github/workflows/)</Text>
              ) : (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginVertical: 8 }}>
                  {workflows.map((w: any, i: number) => (
                    <TouchableOpacity
                      key={i}
                      style={[styles.pucheWorkflow, workflowSelectionne === w.id && styles.pucheWorkflowActif]}
                      onPress={() => setWorkflowSelectionne(w.id)}
                    >
                      <Text style={styles.pucheWorkflowTexte}>{w.name}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity
                style={[styles.boutonRunCI, workflows.length === 0 && { opacity: 0.4 }]}
                onPress={onDeclencher}
                disabled={workflows.length === 0}
              >
                <Text style={styles.boutonRunCITexte}>🚀 Lancer les tests</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Logs d'erreurs + auto-correction via Gemini */}
          {logsErreurCI !== '' && (
            <View style={styles.carteErreurCI}>
              <Text style={styles.titreCarte}>🔍 Rapport d'erreurs</Text>
              <ScrollView style={styles.zoneLogs} nestedScrollEnabled>
                <Text style={styles.texteLogs}>{logsErreurCI}</Text>
              </ScrollView>
              <TouchableOpacity style={styles.boutonAutoCorrection} onPress={onAutoCorrection}>
                <Text style={styles.boutonAutoCorrectionTexte}>🔧 Envoyer à Gemini pour corriger</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* Pull Request */}
          {urlPullRequest !== '' && (
            <TouchableOpacity style={styles.boutonPR} onPress={onOuvrirPR}>
              <Text style={styles.boutonPRTexte}>🔗 Voir la Pull Request sur GitHub</Text>
            </TouchableOpacity>
          )}
        </>
      )}
    </ScrollView>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// ─── PALETTE DE COULEURS ─────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────
const C = {
  bg0: '#07080F',
  bg1: '#0D0F1C',
  surface: '#161B30',
  surfaceRaised: '#1D2340',
  border: '#252A45',
  accent: '#6366F1',
  accentMuted: '#2D2F6A',
  vert: '#10B981',
  vertMuted: '#0A3D2E',
  rouge: '#EF4444',
  rougeMuted: '#3D0A0A',
  jaune: '#F59E0B',
  texte: '#F8FAFC',
  texteMuted: '#6B7599',
  texteSubtle: '#3F4860',
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: C.bg0 },
  conteneur: { flex: 1, backgroundColor: C.bg0 },
  ecranContenu: { flex: 1 },

  // ── Modal Configuration
  modalConfig: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: C.bg0, zIndex: 1000 },
  modalConfigContent: { padding: 20, paddingBottom: 40 },
  modalConfigEntete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 },
  modalTitre: { fontSize: 20, fontWeight: '800', color: C.texte },
  boutonFermer: { width: 32, height: 32, backgroundColor: C.surface, borderRadius: 16, justifyContent: 'center', alignItems: 'center' },
  boutonFermerTexte: { color: C.texteMuted, fontSize: 14, fontWeight: '700' },
  labelGroupe: { color: C.accent, fontSize: 11, fontWeight: '800', letterSpacing: 1.5, marginTop: 20, marginBottom: 8 },
  inputConfig: { backgroundColor: C.surface, color: C.texte, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderColor: C.border, fontSize: 14, marginBottom: 10 },
  rangeeDoubleInput: { flexDirection: 'row' },
  boutonPrimaire: { backgroundColor: C.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center', marginTop: 24 },
  boutonPrimaireTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 15 },

  // ── En-tête
  enTete: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border },
  enTeteGauche: { flexDirection: 'row', alignItems: 'center' },
  enTeteDroite: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  logoBadge: { width: 36, height: 36, backgroundColor: C.accentMuted, borderRadius: 10, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
  logoEmoji: { fontSize: 18 },
  titreEnTete: { fontSize: 16, fontWeight: '800', color: C.texte },
  sousTitreEnTete: { fontSize: 11, color: C.texteMuted, marginTop: 1 },
  pastilleVerte: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.vert },
  boutonConfigEnTete: { width: 36, height: 36, backgroundColor: C.surface, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border },
  iconConfig: { fontSize: 16 },

  // ── Navigation onglets
  corps: { flex: 1 },
  barreOnglets: { flexDirection: 'row', backgroundColor: C.bg1, borderTopWidth: 1, borderTopColor: C.border, paddingBottom: 4 },
  boutonOnglet: { flex: 1, alignItems: 'center', paddingVertical: 10, position: 'relative' },
  boutonOngletActif: { borderTopWidth: 2, borderTopColor: C.accent },
  ongletEmoji: { fontSize: 20 },
  ongletLabel: { fontSize: 10, color: C.texteMuted, fontWeight: '600', marginTop: 2 },
  ongletLabelActif: { color: C.accent },
  badgeOnglet: { position: 'absolute', top: 6, right: 16, borderRadius: 8, minWidth: 16, height: 16, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 3 },
  badgeOngletTexte: { color: '#FFFFFF', fontSize: 9, fontWeight: '800' },

  // ── Chat
  bandeauInfo: { backgroundColor: C.accentMuted, paddingVertical: 7, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: C.border },
  bandeauInfoTexte: { color: C.texteMuted, fontSize: 12 },
  bandeauAvertissement: { backgroundColor: '#3D2A00', paddingVertical: 8, paddingHorizontal: 16, borderBottomWidth: 1, borderBottomColor: '#7A5200' },
  bandeauAvertissementTexte: { color: C.jaune, fontSize: 12, fontWeight: '600' },
  scrollChat: { flex: 1, backgroundColor: C.bg0 },
  contentScrollChat: { padding: 16, paddingBottom: 8 },
  etatVideChat: { paddingTop: 40, alignItems: 'center', paddingHorizontal: 24 },
  etatVide: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  etatVideEmoji: { fontSize: 48, marginBottom: 16 },
  etatVideTitre: { fontSize: 18, fontWeight: '800', color: C.texte, marginBottom: 8, textAlign: 'center' },
  etatVideSousTitre: { fontSize: 13, color: C.texteMuted, textAlign: 'center', lineHeight: 20 },
  listePhrases: { marginTop: 24, width: '100%' },
  exPhrase: { backgroundColor: C.surface, color: C.texteMuted, fontSize: 12, padding: 12, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: C.border, fontStyle: 'italic' },
  messageSysteme: { alignSelf: 'center', marginVertical: 4, maxWidth: '90%' },
  texteMessageSysteme: { color: C.texteSubtle, fontSize: 11, textAlign: 'center', fontStyle: 'italic' },
  bulleChat: { flexDirection: 'row', marginBottom: 16 },
  bulleChatIA: { alignItems: 'flex-start' },
  bulleChatUser: { justifyContent: 'flex-end' },
  avatarIA: { fontSize: 22, marginRight: 8, marginTop: 4 },
  contentenBulle: { maxWidth: '82%', borderRadius: 16, padding: 12 },
  contentenBulleIA: { backgroundColor: C.surface, borderTopLeftRadius: 4, borderWidth: 1, borderColor: C.border },
  contentenBulleUser: { backgroundColor: C.accentMuted, borderTopRightRadius: 4, borderWidth: 1, borderColor: C.accent },
  texteMessage: { fontSize: 14, lineHeight: 20, color: C.texte },
  timestampMessage: { color: C.texteSubtle, fontSize: 10, marginTop: 6, textAlign: 'right' },
  indicateurTyping: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.surface, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: C.border },
  texteTyping: { color: C.texteMuted, fontSize: 12, marginLeft: 10, flex: 1 },
  zoneInputChat: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingVertical: 10, backgroundColor: C.bg1, borderTopWidth: 1, borderTopColor: C.border },
  // Zone de saisie positionnée EN HAUT de l'écran chat
  zoneInputChatHaut: { backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border },
  // Rangée contenant le TextInput + bouton Envoyer
  inputChatWrapper: { flexDirection: 'row', alignItems: 'flex-end', paddingHorizontal: 12, paddingTop: 12, paddingBottom: 8 },
  inputChat: { flex: 1, backgroundColor: C.surface, color: C.texte, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1, borderColor: C.border, maxHeight: 120, marginRight: 8 },
  boutonEnvoyer: { width: 42, height: 42, backgroundColor: C.accent, borderRadius: 12, justifyContent: 'center', alignItems: 'center' },
  boutonEnvoyerDesactive: { backgroundColor: C.border },
  boutonEnvoyerTexte: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', lineHeight: 20 },


  // ── Projet / Éditeur
  barreOutils: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 10, backgroundColor: C.bg1, borderBottomWidth: 1, borderBottomColor: C.border },
  titreBarreOutils: { color: C.texteMuted, fontSize: 12, fontWeight: '700' },
  badgesMode: { flexDirection: 'row', gap: 6 },
  badgeMode: { paddingVertical: 5, paddingHorizontal: 10, backgroundColor: C.surface, borderRadius: 8, borderWidth: 1, borderColor: C.border },
  badgeModeActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  badgeModeActifVert: { backgroundColor: C.vertMuted, borderColor: C.vert },
  badgeModeTexte: { color: C.texteMuted, fontSize: 11, fontWeight: '700' },
  badgeModeTexteActif: { color: C.accent },
  scrollSelecteurFichier: { paddingVertical: 8, paddingHorizontal: 12, maxHeight: 50 },
  pucheSelecteurFichier: { paddingVertical: 5, paddingHorizontal: 12, backgroundColor: C.surface, borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: C.border },
  pucheSelecteurFichierActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  pucheSelecteurFichierTexte: { color: C.texteMuted, fontSize: 11, fontWeight: '600' },
  zoneCode: { flex: 1, margin: 12, backgroundColor: C.bg0, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 12 },
  codeMonospace: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, color: '#10B981', lineHeight: 18 },
  boutonCommit: { marginHorizontal: 12, marginTop: 8, backgroundColor: C.accent, paddingVertical: 14, borderRadius: 12, alignItems: 'center' },
  boutonCommitTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  boutonPR: { marginHorizontal: 12, marginTop: 8, marginBottom: 12, backgroundColor: C.vertMuted, paddingVertical: 12, borderRadius: 12, alignItems: 'center', borderWidth: 1, borderColor: C.vert },
  boutonPRTexte: { color: C.vert, fontWeight: '700', fontSize: 13 },

  // ── CI/CD
  carteCI: { backgroundColor: C.surface, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.border },
  labelCarteCI: { color: C.texteMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, marginBottom: 6 },
  valeurCarteCI: { color: C.texte, fontSize: 14, fontWeight: '700' },
  titreCarte: { color: C.texte, fontSize: 13, fontWeight: '700', marginBottom: 10 },
  ligneStatutCI: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconStatutCI: { fontSize: 24 },
  texteStatutCI: { color: '#F8FAFC', fontSize: 14, fontWeight: '700' },
  nomWorkflowCI: { color: '#94A3B8', fontSize: 11, marginTop: 2 },
  lienCI: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.1)' },
  lienCITexte: { color: '#93C5FD', fontSize: 12 },
  texteAucunWorkflow: { color: C.texteMuted, fontSize: 12, fontStyle: 'italic', marginVertical: 8 },
  pucheWorkflow: { paddingVertical: 6, paddingHorizontal: 12, backgroundColor: C.surfaceRaised, borderRadius: 8, marginRight: 6, borderWidth: 1, borderColor: C.border },
  pucheWorkflowActif: { backgroundColor: C.accentMuted, borderColor: C.accent },
  pucheWorkflowTexte: { color: C.texte, fontSize: 11, fontWeight: '600' },
  boutonRunCI: { backgroundColor: C.accent, paddingVertical: 13, borderRadius: 12, alignItems: 'center', marginTop: 12 },
  boutonRunCITexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  carteErreurCI: { backgroundColor: C.rougeMuted, borderRadius: 14, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: C.rouge },
  zoneLogs: { maxHeight: 120, backgroundColor: '#0D0100', borderRadius: 8, padding: 10, marginBottom: 12 },
  texteLogs: { color: '#FCA5A5', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', fontSize: 11, lineHeight: 16 },
  boutonAutoCorrection: { backgroundColor: C.rouge, paddingVertical: 12, borderRadius: 10, alignItems: 'center' },
  boutonAutoCorrectionTexte: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },

  // ── Overlay chargement global
  overlayChargement: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(7, 8, 15, 0.8)', justifyContent: 'center', alignItems: 'center', zIndex: 999 },
  carteChargement: { backgroundColor: C.surfaceRaised, borderRadius: 20, padding: 28, alignItems: 'center', marginHorizontal: 40, borderWidth: 1, borderColor: C.border },
  texteChargement: { color: C.texte, marginTop: 14, fontSize: 13, fontWeight: '600', textAlign: 'center' },
});
