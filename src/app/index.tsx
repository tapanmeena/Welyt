import { Image, StyleSheet, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function HelloWorldScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <Image
        source={require('../../assets/icon.png')}
        style={styles.logo}
        accessibilityLabel="Welyt logo"
      />
      <Text style={styles.text}>Hello World</Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#ffffff',
    gap: 24,
  },
  logo: {
    width: 96,
    height: 96,
    borderRadius: 27,
  },
  text: {
    color: '#111111',
    fontSize: 24,
  },
});
