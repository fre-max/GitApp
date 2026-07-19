import React, { useState, useEffect } from 'react';
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
  Linking
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Importation des services locaux pour interagir avec les API
import {
  recupererContenuFichier,
  creerNouvelleBranche,
  commiterFichier,
  creerPullRequest
} from './src/services/github';
import { modifierCodeAvecGemini } from './src/services/gemini';

// Clés de stockage pour sauvegarder les configurations dans AsyncStorage
const CLE_STORAGE_CONFIG = '@remote_code_config';

export default function App() {
  // --- États de configuration (API et Dépôt) ---
  const [tokenGithub, setTokenGithub] = useState('');
  const [cleGemini, setCleGemini] = useState('');
  const [proprietaire, setProprietaire] = useState('');
  const [nomDepot, setNomDepot] = useState('');
  const [brancheCible, setBrancheCible] = useState('main');
  const [cheminFichier, setCheminFichier] = useState('');

  // --- États de l'application ---
  const [chargement, setChargement] = useState(false);
  const [etapeChargement, setEtapeChargement] = useState('');
  const [afficherConfig, setAfficherConfig] = useState(true);
  const [codeOriginal, setCodeOriginal] = useState('');
  const [shaOriginal, setShaOriginal] = useState('');
  const [consigne, setConsigne] = useState('');
  const [codeModifie, setCodeModifie] = useState('');
  const [ongletActif, setOngletActif] = useState<'original' | 'modifie'>('original');
  const [urlPullRequest, setUrlPullRequest] = useState('');

  // Charge les paramètres de configuration sauvegardés au démarrage
  useEffect(() => {
    chargerConfiguration();
  }, []);

  // Charge la configuration stockée localement
  // Exemple : chargerConfiguration() charge le token et la clé d'API
  const chargerConfiguration = async () => {
    try {
      console.log('🚀 [App] Chargement de la configuration...');
      const donneesStockees = await AsyncStorage.getItem(CLE_STORAGE_CONFIG);
      if (donneesStockees) {
        const config = JSON.parse(donneesStockees);
        setTokenGithub(config.tokenGithub || '');
        setCleGemini(config.cleGemini || '');
        setProprietaire(config.proprietaire || '');
        setNomDepot(config.nomDepot || '');
        setBrancheCible(config.brancheCible || 'main');
        setCheminFichier(config.cheminFichier || '');
        console.log('✅ [App] Configuration chargée avec succès');
        
        // Si tout est renseigné, on peut masquer le panneau de config pour épurer l'UI
        if (config.tokenGithub && config.cleGemini && config.proprietaire && config.nomDepot && config.cheminFichier) {
          setAfficherConfig(false);
        }
      }
    } catch (erreur) {
      console.error('❌ [App] Impossible de charger la configuration:', erreur);
    }
  };

  // Sauvegarde les paramètres de configuration dans AsyncStorage
  // Exemple : sauvegarderConfiguration()
  const sauvegarderConfiguration = async () => {
    try {
      console.log('🚀 [App] Sauvegarde de la configuration...');
      const config = {
        tokenGithub,
        cleGemini,
        proprietaire,
        nomDepot,
        brancheCible,
        cheminFichier
      };
      await AsyncStorage.setItem(CLE_STORAGE_CONFIG, JSON.stringify(config));
      Alert.alert('Succès', 'Configuration sauvegardée localement !');
      setAfficherConfig(false);
    } catch (erreur) {
      console.error('❌ [App] Impossible de sauvegarder la configuration:', erreur);
      Alert.alert('Erreur', 'Impossible de sauvegarder les paramètres.');
    }
  };

  // 1️⃣ RÉCUPÉRATION DU FICHIER DEPUIS GITHUB
  // Récupère le code original et son SHA en faisant un appel API REST
  const gererChargementFichier = async () => {
    if (!tokenGithub || !proprietaire || !nomDepot || !cheminFichier) {
      Alert.alert('Erreur', 'Veuillez remplir toutes les informations GitHub dans la configuration.');
      setAfficherConfig(true);
      return;
    }

    setChargement(true);
    setEtapeChargement('Récupération du fichier depuis GitHub...');
    setCodeOriginal('');
    setCodeModifie('');
    setUrlPullRequest('');

    try {
      const fichier = await recupererContenuFichier(
        tokenGithub,
        proprietaire,
        nomDepot,
        cheminFichier,
        brancheCible
      );
      setCodeOriginal(fichier.content);
      setShaOriginal(fichier.sha);
      setOngletActif('original');
      Alert.alert('Succès', 'Fichier récupéré avec succès !');
    } catch (erreur: any) {
      Alert.alert('Erreur de chargement', erreur.message || 'Impossible de récupérer le fichier.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 2️⃣ DEMANDE DE MODIFICATION DU CODE VIA GEMINI
  // Envoie le code original et la consigne à l'API Gemini et récupère le code modifié
  const gererModificationCode = async () => {
    if (!cleGemini) {
      Alert.alert('Erreur', 'Veuillez renseigner votre clé API Gemini.');
      setAfficherConfig(true);
      return;
    }
    if (!codeOriginal) {
      Alert.alert('Erreur', 'Veuillez d\'abord charger un fichier de code depuis GitHub.');
      return;
    }
    if (!consigne.trim()) {
      Alert.alert('Erreur', 'Veuillez saisir une consigne pour l\'IA.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Gemini modifie votre code...');
    setCodeModifie('');

    try {
      const resultat = await modifierCodeAvecGemini(
        cleGemini,
        codeOriginal,
        consigne,
        cheminFichier.split('/').pop() || 'fichier.txt'
      );
      setCodeModifie(resultat);
      setOngletActif('modifie');
      Alert.alert('Succès', 'Code modifié généré par Gemini !');
    } catch (erreur: any) {
      Alert.alert('Erreur de génération', erreur.message || 'Échec de la modification par l\'IA.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // 3️⃣ SOUMISSION DES MODIFICATIONS SUR GITHUB
  // Crée une branche, commite le fichier modifié et optionnellement crée une Pull Request
  const gererSoumissionGitHub = async () => {
    if (!codeModifie) {
      Alert.alert('Erreur', 'Aucun code modifié disponible à commiter.');
      return;
    }

    setChargement(true);
    setEtapeChargement('Initialisation de la branche de modification...');
    
    // Génération dynamique du nom de branche (feature/ai-update-timestamp)
    const timestamp = Math.floor(Date.now() / 1000);
    const nomNouvelleBranche = `feature/telecommande-ia-${timestamp}`;
    const messageCommit = `[IA Remote] Modification de ${cheminFichier} selon consigne`;

    try {
      // Étape 3a: Créer la nouvelle branche
      setEtapeChargement('Création de la branche sur GitHub...');
      await creerNouvelleBranche(
        tokenGithub,
        proprietaire,
        nomDepot,
        brancheCible,
        nomNouvelleBranche
      );

      // Étape 3b: Pousser le fichier modifié
      setEtapeChargement('Commit et push du code modifié...');
      await commiterFichier(
        tokenGithub,
        proprietaire,
        nomDepot,
        cheminFichier,
        codeModifie,
        shaOriginal,
        messageCommit,
        nomNouvelleBranche
      );

      // Étape 3c: Créer une Pull Request
      setEtapeChargement('Création de la Pull Request...');
      const titrePR = `[IA] Modification de ${cheminFichier.split('/').pop()}`;
      const descriptionPR = `Modifications apportées via l'application mobile Télécommandeur de Code IA.\n\n**Consigne fournie :**\n> ${consigne}`;
      
      const prUrl = await creerPullRequest(
        tokenGithub,
        proprietaire,
        nomDepot,
        titrePR,
        descriptionPR,
        nomNouvelleBranche,
        brancheCible
      );

      setUrlPullRequest(prUrl);
      Alert.alert(
        'Opération réussie ! 🎉',
        `La branche ${nomNouvelleBranche} a été créée et une Pull Request a été ouverte.`
      );
    } catch (erreur: any) {
      Alert.alert('Échec de soumission', erreur.message || 'Impossible de soumettre le code.');
    } finally {
      setChargement(false);
      setEtapeChargement('');
    }
  };

  // Ouvre le lien de la PR dans le navigateur du smartphone
  const gererOuverturePR = () => {
    if (urlPullRequest) {
      Linking.openURL(urlPullRequest);
    }
  };

  return (
    <SafeAreaView style={styles.conteneurSafeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#0B0F19" />
      <View style={styles.conteneur}>
        
        {/* En-tête de l'application */}
        <View style={styles.enTete}>
          <Text style={styles.titreApp}>🤖 IA Code Remote</Text>
          <TouchableOpacity 
            style={styles.boutonReglages} 
            onPress={() => setAfficherConfig(!afficherConfig)}
          >
            <Text style={styles.texteBoutonReglages}>
              {afficherConfig ? '✕ Fermer' : '⚙️ Paramètres'}
            </Text>
          </TouchableOpacity>
        </View>

        {/* Section de Configuration API (Pliable) */}
        {afficherConfig && (
          <ScrollView style={styles.zoneConfig} contentContainerStyle={styles.zoneConfigContent}>
            <Text style={styles.titreSection}>🔑 Configuration d'accès</Text>
            
            <Text style={styles.labelInput}>Clé API Gemini</Text>
            <TextInput
              style={styles.input}
              placeholder="Saisir la clé Gemini"
              placeholderTextColor="#64748B"
              secureTextEntry
              value={cleGemini}
              onChangeText={setCleGemini}
            />

            <Text style={styles.labelInput}>Token GitHub Personal Access</Text>
            <TextInput
              style={styles.input}
              placeholder="ghp_..."
              placeholderTextColor="#64748B"
              secureTextEntry
              value={tokenGithub}
              onChangeText={setTokenGithub}
            />

            <View style={styles.ligneDoubleInput}>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Propriétaire Dépôt</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: octocat"
                  placeholderTextColor="#64748B"
                  value={proprietaire}
                  onChangeText={setProprietaire}
                />
              </View>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Nom Dépôt</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: Hello-World"
                  placeholderTextColor="#64748B"
                  value={nomDepot}
                  onChangeText={setNomDepot}
                />
              </View>
            </View>

            <View style={styles.ligneDoubleInput}>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Branche Source</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: main"
                  placeholderTextColor="#64748B"
                  value={brancheCible}
                  onChangeText={setBrancheCible}
                />
              </View>
              <View style={styles.colonneInput}>
                <Text style={styles.labelInput}>Chemin Fichier</Text>
                <TextInput
                  style={styles.input}
                  placeholder="ex: src/App.tsx"
                  placeholderTextColor="#64748B"
                  value={cheminFichier}
                  onChangeText={setCheminFichier}
                />
              </View>
            </View>

            <TouchableOpacity style={styles.boutonSauvegarder} onPress={sauvegarderConfiguration}>
              <Text style={styles.texteBoutonSauvegarder}>💾 Sauvegarder la config</Text>
            </TouchableOpacity>
          </ScrollView>
        )}

        {/* Corps principal : Zone de visualisation et d'action */}
        {!afficherConfig && (
          <View style={styles.corpsPrincipal}>
            
            {/* Informations sur le fichier chargé */}
            <View style={styles.panneauInfoFichier}>
              <Text style={styles.texteInfoFichier}>
                📁 Dépôt : <Text style={styles.texteGras}>{proprietaire}/{nomDepot}</Text>
              </Text>
              <Text style={styles.texteInfoFichier}>
                📄 Fichier : <Text style={styles.texteGras}>{cheminFichier || 'Aucun'}</Text> [{brancheCible}]
              </Text>
              
              <TouchableOpacity style={styles.boutonChargerFichier} onPress={gererChargementFichier}>
                <Text style={styles.texteBoutonChargerFichier}>📥 Charger/Actualiser le fichier</Text>
              </TouchableOpacity>
            </View>

            {/* Sélecteur d'onglets (Code Original vs Code Modifié) */}
            <View style={styles.barreOnglets}>
              <TouchableOpacity
                style={[styles.onglet, ongletActif === 'original' && styles.ongletActif]}
                onPress={() => setOngletActif('original')}
              >
                <Text style={[styles.texteOnglet, ongletActif === 'original' && styles.texteOngletActif]}>
                  Code Original
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.onglet, 
                  ongletActif === 'modifie' && styles.ongletActif,
                  !codeModifie && styles.ongletDesactive
                ]}
                disabled={!codeModifie}
                onPress={() => setOngletActif('modifie')}
              >
                <Text style={[
                  styles.texteOnglet, 
                  ongletActif === 'modifie' && styles.texteOngletActif,
                  !codeModifie && styles.texteOngletDesactive
                ]}>
                  Code Modifié ✨
                </Text>
              </TouchableOpacity>
            </View>

            {/* Zone de code */}
            <View style={styles.zoneCode}>
              <ScrollView style={styles.defilementCode} horizontal>
                <ScrollView>
                  <Text style={styles.texteCodeMonospace}>
                    {ongletActif === 'original' 
                      ? (codeOriginal || '// Aucun fichier chargé. Cliquez sur Charger ci-dessus.') 
                      : (codeModifie || '// En attente des modifications de l\'IA...')}
                  </Text>
                </ScrollView>
              </ScrollView>
            </View>

            {/* Fenêtre de saisie de consigne IA */}
            <View style={styles.zoneConsole}>
              <TextInput
                style={styles.inputConsigne}
                placeholder="Consigne IA (ex: Ajoute une fonction de tri...)"
                placeholderTextColor="#64748B"
                value={consigne}
                onChangeText={setConsigne}
                multiline
                numberOfLines={2}
              />
              <TouchableOpacity 
                style={[styles.boutonGenerer, !codeOriginal && styles.boutonDesactive]}
                disabled={!codeOriginal}
                onPress={gererModificationCode}
              >
                <Text style={styles.texteBoutonGenerer}>🧠 Demander à Gemini</Text>
              </TouchableOpacity>
            </View>

            {/* Zone de validation et soumission */}
            {codeModifie !== '' && (
              <View style={styles.zoneSoumission}>
                <TouchableOpacity style={styles.boutonCommiter} onPress={gererSoumissionGitHub}>
                  <Text style={styles.texteBoutonCommiter}>🚀 Créer Branche & Commiter</Text>
                </TouchableOpacity>
              </View>
            )}

            {/* Notification de PR disponible */}
            {urlPullRequest !== '' && (
              <TouchableOpacity style={styles.boutonPr} onPress={gererOuverturePR}>
                <Text style={styles.texteBoutonPr}>🔗 Ouvrir la Pull Request sur GitHub</Text>
              </TouchableOpacity>
            )}

          </View>
        )}

        {/* Indicateur de chargement en surimpression */}
        {chargement && (
          <View style={styles.surimpressionChargement}>
            <ActivityIndicator size="large" color="#3B82F6" />
            <Text style={styles.texteChargement}>{etapeChargement}</Text>
          </View>
        )}

      </View>
    </SafeAreaView>
  );
}

// --- Styles UI Premium ---
const styles = StyleSheet.create({
  conteneurSafeArea: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  conteneur: {
    flex: 1,
    backgroundColor: '#0B0F19',
  },
  enTete: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1E293B',
    backgroundColor: '#0F172A',
  },
  titreApp: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#F8FAFC',
  },
  boutonReglages: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  texteBoutonReglages: {
    color: '#94A3B8',
    fontSize: 13,
    fontWeight: '600',
  },
  zoneConfig: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  zoneConfigContent: {
    padding: 16,
  },
  titreSection: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#3B82F6',
    marginBottom: 16,
  },
  labelInput: {
    color: '#94A3B8',
    fontSize: 12,
    marginBottom: 6,
    marginTop: 10,
    fontWeight: '600',
  },
  input: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 14,
  },
  ligneDoubleInput: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 4,
  },
  colonneInput: {
    flex: 0.48,
  },
  boutonSauvegarder: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 24,
    shadowColor: '#3B82F6',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  texteBoutonSauvegarder: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  corpsPrincipal: {
    flex: 1,
    padding: 16,
  },
  panneauInfoFichier: {
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
    marginBottom: 14,
  },
  texteInfoFichier: {
    color: '#94A3B8',
    fontSize: 13,
    marginBottom: 4,
  },
  texteGras: {
    color: '#F8FAFC',
    fontWeight: 'bold',
  },
  boutonChargerFichier: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  texteBoutonChargerFichier: {
    color: '#3B82F6',
    fontWeight: 'bold',
    fontSize: 13,
  },
  barreOnglets: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  onglet: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: '#1E293B',
  },
  ongletActif: {
    borderBottomColor: '#3B82F6',
  },
  ongletDesactive: {
    opacity: 0.5,
  },
  texteOnglet: {
    color: '#64748B',
    fontWeight: 'bold',
    fontSize: 14,
  },
  texteOngletActif: {
    color: '#F8FAFC',
  },
  texteOngletDesactive: {
    color: '#334155',
  },
  zoneCode: {
    flex: 1,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  defilementCode: {
    flex: 1,
  },
  texteCodeMonospace: {
    fontFamily: 'monospace',
    fontSize: 12,
    color: '#10B981', // Vert style terminal
    lineHeight: 16,
  },
  zoneConsole: {
    marginTop: 14,
    backgroundColor: '#0F172A',
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: '#1E293B',
  },
  inputConsigne: {
    backgroundColor: '#0B0F19',
    color: '#F8FAFC',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#334155',
    fontSize: 14,
    textAlignVertical: 'top',
    marginBottom: 10,
  },
  boutonGenerer: {
    backgroundColor: '#10B981',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  boutonDesactive: {
    backgroundColor: '#1E293B',
    opacity: 0.6,
  },
  texteBoutonGenerer: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  zoneSoumission: {
    marginTop: 12,
  },
  boutonCommiter: {
    backgroundColor: '#3B82F6',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    shadowColor: '#3B82F6',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 8,
    elevation: 3,
  },
  texteBoutonCommiter: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 15,
  },
  boutonPr: {
    backgroundColor: '#6366F1',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 10,
  },
  texteBoutonPr: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 14,
  },
  surimpressionChargement: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(11, 15, 25, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  texteChargement: {
    color: '#F8FAFC',
    marginTop: 12,
    fontSize: 14,
    fontWeight: '600',
  },
});
