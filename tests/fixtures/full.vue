<template>
  <!-- comment — exempt -->
  <p>text node —</p>
  <span>{{ 'interpolated —' }}</span>
  <img alt="alt —" class="cls-—" data-x="d-—" />
  <meta content="meta —" />
  <button :title="'bound —'" :data-z="'skip —'">go</button>
</template>

<script setup lang="ts">
// a comment — exempt
const label = "literal —";
</script>

<script lang="ts">
export default { name: "plain —" };
</script>

<style>
/* style — exempt */
.a { color: red }
</style>
