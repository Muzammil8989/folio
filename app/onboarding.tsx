import { useUser } from '@/features/user/context/user-context';
import tokens from '@/theme/tokens';
import { useThemeColors } from '@/hooks/use-theme-colors';
import { logger } from '@/lib/logger';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarPicker } from '@/features/onboarding/components/avatar-picker';
import { IntroCarousel } from '@/features/onboarding/components/intro-carousel';
import { IntroService } from '@/features/onboarding/services/intro-service';
import { ContinueButton } from '@/features/onboarding/components/continue-button';
import { OnboardingHeader } from '@/features/onboarding/components/onboarding-header';
import { ProfileForm } from '@/features/onboarding/components/profile-form';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { FormScrollView } from '@/components/common';

export default function OnboardingScreen() {
    const { profile, updateProfile } = useUser();
    const colors = useThemeColors();
    const insets = useSafeAreaInsets();

    // Hydrate from persisted profile so partial progress survives remounts
    // (lock/unlock, app backgrounding, screen replace).
    const [name, setName] = useState(profile.name ?? '');
    const [avatar, setAvatar] = useState<string | null>(profile.avatar ?? null);
    const [currency, setCurrency] = useState(profile.currency ?? 'USD');
    const [isLoading, setIsLoading] = useState(false);
    // First launch: a short tour of the app, then profile setup.
    // Only a brand-new user sees the intro, once. null = still checking.
    const [showIntro, setShowIntro] = useState<boolean | null>(null);
    useEffect(() => {
        let alive = true;
        IntroService.hasSeen().then(seen => { if (alive) setShowIntro(!seen); });
        return () => { alive = false; };
    }, []);
    const finishIntro = useCallback(() => {
        setShowIntro(false);
        IntroService.markSeen();
    }, []);

    // Track whether the local form has diverged from the profile yet — once
    // the user types anything, stop pulling fresh values from context.
    const hasUserEditedRef = useRef(false);

    useEffect(() => {
        if (hasUserEditedRef.current) return;
        setName(profile.name ?? '');
        setAvatar(profile.avatar ?? null);
        setCurrency(profile.currency ?? 'USD');
    }, [profile.name, profile.avatar, profile.currency]);

    // Persist drafts to SecureStore so they survive app restart.
    // We deliberately do NOT set isOnboarded:true here — that only happens on Continue.
    const persistDraft = useCallback(
        (patch: { name?: string; avatar?: string | null; currency?: string }) => {
            updateProfile(patch).catch((e) => logger.error('Failed to persist onboarding draft', e));
        },
        [updateProfile],
    );

    const handleNameChange = useCallback(
        (value: string) => {
            hasUserEditedRef.current = true;
            setName(value);
            persistDraft({ name: value });
        },
        [persistDraft],
    );

    const handleCurrencyChange = useCallback(
        (value: string) => {
            hasUserEditedRef.current = true;
            setCurrency(value);
            persistDraft({ currency: value });
        },
        [persistDraft],
    );

    const pickImage = useCallback(async () => {
        try {
            const result = await ImagePicker.launchImageLibraryAsync({
                mediaTypes: ['images'],
                allowsEditing: true,
                aspect: [1, 1],
                quality: 0.8,
            });
            if (!result.canceled) {
                const uri = result.assets[0].uri;
                hasUserEditedRef.current = true;
                setAvatar(uri);
                persistDraft({ avatar: uri });
            }
        } catch (error) {
            logger.error('Failed to pick image', error);
            Alert.alert('Error', 'Could not access photo library. Please check permissions.');
        }
    }, [persistDraft]);

    const handleContinue = useCallback(async () => {
        if (isLoading) return;
        if (!name.trim()) {
            Alert.alert('Required', 'Please enter your name to continue.');
            return;
        }
        setIsLoading(true);
        try {
            // Navigate here, not from a root-layout effect watching isOnboarded:
            // that effect never reliably fired, leaving the button doing nothing.
            await updateProfile({ name: name.trim(), avatar, currency, isOnboarded: true });
            router.replace('/(tabs)');
        } catch (error) {
            logger.error('Failed to save profile', error);
            Alert.alert('Error', 'Something went wrong saving your profile.');
        } finally {
            setIsLoading(false);
        }
    }, [isLoading, name, avatar, currency, updateProfile]);

    if (showIntro === null) return <View style={{ flex: 1, backgroundColor: colors.background }} />;
    if (showIntro) return <IntroCarousel onDone={finishIntro} />;

    return (
        <View style={{ flex: 1, backgroundColor: tokens.brand.primary }}>
            {/* Light icons over the dark teal header (overrides the root bar while mounted) */}
            <StatusBar style="light" />
            <KeyboardAvoidingView
                className="flex-1"
                behavior="padding"
            >
                <FormScrollView
                    className="flex-1"
                    showsVerticalScrollIndicator={false}
                    keyboardShouldPersistTaps="handled"
                    contentContainerStyle={{ flexGrow: 1 }}
                >
                    <OnboardingHeader safeAreaTop={insets.top} />

                    {/* Card — rounded top creates the wave break */}
                    <View
                        className="flex-1 rounded-t-3xl px-5 pt-6"
                        style={{ backgroundColor: colors.surface, paddingBottom: insets.bottom + 20 }}
                    >
                        <View style={{ flex: 1, justifyContent: 'center' }}>
                            <AvatarPicker avatar={avatar} name={name} onPress={pickImage} />
                            <ProfileForm
                                name={name}
                                onNameChange={handleNameChange}
                                currency={currency}
                                onCurrencyChange={handleCurrencyChange}
                            />
                        </View>
                        <ContinueButton onPress={handleContinue} isLoading={isLoading} />
                    </View>
                </FormScrollView>
            </KeyboardAvoidingView>
        </View>
    );
}
