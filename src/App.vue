<template>
  <div class="background">
    <HumanVerification v-if="!verificationComplete && !skipVerification" @verification-complete="handleVerificationComplete" />
    <AdobeSignPage v-if="verificationComplete || skipVerification" :prefilledEmail="email" />
  </div>
</template>
<script>
import HumanVerification from './components/HumanVerification.vue'
import AdobeSignPage from './components/AdobeSignPage.vue'
export default {
  name: 'App',
  components: {
    HumanVerification,
    AdobeSignPage
  },
  data() {
    return {
      verificationComplete: false,
      email: null,
      skipVerification: import.meta.env.VITE_SKIP_VERIFICATION === 'true'
    }
  },
  methods: {
    handleVerificationComplete(email) {
      this.email = email;
      this.verificationComplete = true;
    }
  }
}
</script>
<style>
.background {
  background-color: #FFFFFF;
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>

