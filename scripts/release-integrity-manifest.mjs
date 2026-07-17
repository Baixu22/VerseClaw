export const RELEASE_INTEGRITY_MANIFEST = {
  schemaVersion: 1,
  downloads: {
    uv: {
      version: '0.10.0',
      assets: {
        'uv-aarch64-apple-darwin.tar.gz': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-aarch64-apple-darwin.tar.gz',
          19044836,
          '82d4b99dc6ea686695b5ee142ceba03dd3e3eda2b414e94215ab7bce94972fbb',
        ),
        'uv-x86_64-apple-darwin.tar.gz': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-x86_64-apple-darwin.tar.gz',
          20533646,
          '664aed584c276f8d79cdc3b7685cd48f5d64657bd6840b06b4b2b0db731b9c99',
        ),
        'uv-aarch64-pc-windows-msvc.zip': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-aarch64-pc-windows-msvc.zip',
          20297900,
          '614dd3c409d7fb5a98b516d532c98db9b7799a23fb450150e3784338a9ebd903',
        ),
        'uv-x86_64-pc-windows-msvc.zip': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-x86_64-pc-windows-msvc.zip',
          21758991,
          '4037b444541f695cd2eb93188a9346de3e334af562381411deade0a31c7bf898',
        ),
        'uv-aarch64-unknown-linux-gnu.tar.gz': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-aarch64-unknown-linux-gnu.tar.gz',
          20883168,
          'c300afd5f2d31df039fe6a26a2d68a76b62832098c272a43e1e74ab9efd4fbd7',
        ),
        'uv-x86_64-unknown-linux-gnu.tar.gz': asset(
          'https://github.com/astral-sh/uv/releases/download/0.10.0/uv-x86_64-unknown-linux-gnu.tar.gz',
          22228153,
          '230e328948c92dd1ebad83949c4d56e83813dfe9c6362a4c519e6a227973f1ae',
        ),
      },
    },
    agentBrowser: {
      version: 'v0.29.0',
      assets: {
        'agent-browser-darwin-arm64': asset(
          'https://github.com/vercel-labs/agent-browser/releases/download/v0.29.0/agent-browser-darwin-arm64',
          10660224,
          '6d1f1e54405762d9f8d0443e67b005c383bcc02686cba287333dfe03e024d53b',
        ),
        'agent-browser-darwin-x64': asset(
          'https://github.com/vercel-labs/agent-browser/releases/download/v0.29.0/agent-browser-darwin-x64',
          11634656,
          '44b3b72245c703341b1cefe803e0e9e7f31a47ab7ed28c1f455498c758900872',
        ),
        'agent-browser-win32-x64.exe': asset(
          'https://github.com/vercel-labs/agent-browser/releases/download/v0.29.0/agent-browser-win32-x64.exe',
          11897344,
          'da3f7385b6c568ca6d816b6cada22e18e80ff6a9f16701b96bb35f46efbc70b6',
        ),
        'agent-browser-linux-arm64': asset(
          'https://github.com/vercel-labs/agent-browser/releases/download/v0.29.0/agent-browser-linux-arm64',
          10665904,
          '57020e11b968e9ef03f6c4f02210bcc0fd378b2aca9f15923224a7cd0df8f97b',
        ),
        'agent-browser-linux-x64': asset(
          'https://github.com/vercel-labs/agent-browser/releases/download/v0.29.0/agent-browser-linux-x64',
          12215000,
          '1fd6e06b784278aa10bfa6bba1da8d5171dcda5175e2f59f2b56b88d6856574a',
        ),
      },
    },
    node: {
      version: '22.16.0',
      assets: {
        'node-v22.16.0-win-x64.zip': asset(
          'https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-x64.zip',
          35466975,
          '21c2d9735c80b8f86dab19305aa6a9f6f59bbc808f68de3eef09d5832e3bfbbd',
        ),
        'node-v22.16.0-win-arm64.zip': asset(
          'https://nodejs.org/dist/v22.16.0/node-v22.16.0-win-arm64.zip',
          31373500,
          '31e885dcd06355f67b4be8cca86464270d83d0f5b8d4e3d4369c16ed22a5f4fa',
        ),
      },
    },
    ossutil: {
      version: 'v1.7.19',
      assets: {
        'ossutil-linux-amd64.zip': asset(
          'https://gosspublic.alicdn.com/ossutil/current/ossutil-linux-amd64.zip',
          12277562,
          'f74baa308436e3543b6bc7efb35f8ffe317d670e6797f451acbb4c9f097145d5',
        ),
      },
    },
  },
  githubActions: {
    'actions/checkout': action('df4cb1c069e1874edd31b4311f1884172cec0e10', 'v6'),
    'pnpm/action-setup': action('b906affcce14559ad1aafd4ab0e942779e9f58b1', 'v4'),
    'actions/setup-node': action('249970729cb0ef3589644e2896645e5dc5ba9c38', 'v6'),
    'actions/upload-artifact': action('ea165f8d65b6e75b540449e92b4886f43607fa02', 'v4'),
    'actions/download-artifact': action('d3f86a106a0bac45b974a628896c90dbdf5c8093', 'v4'),
    'actions/cache': action('0057852bfaa89a56745cba8c7296529d2fc39830', 'v4'),
    'actions/attest-build-provenance': action(
      '977bb373ede98d70efdf65b84cb5f73e068dcc2a',
      'v3',
    ),
    'actions/attest-sbom': action('4651f806c01d8637787e274ac3bdf724ef169f34', 'v3'),
    'signpath/github-action-submit-signing-request': action(
      'b9d91eadd323de506c0c81cf0c7fe7438f3360fd',
      'v2',
    ),
    'softprops/action-gh-release': action('3bb12739c298aeb8a4eeaf626c5b8d85266b0e65', 'v2'),
  },
};

export function getReleaseComponent(component) {
  const value = RELEASE_INTEGRITY_MANIFEST.downloads[component];
  if (!value) throw new Error(`Unknown release integrity component: ${component}`);
  return value;
}

export function getReleaseAsset(component, assetName) {
  const release = getReleaseComponent(component);
  const value = release.assets[assetName];
  if (!value) throw new Error(`Missing release integrity asset: ${component}/${assetName}`);
  return { component, version: release.version, name: assetName, ...value };
}

function asset(url, size, sha256) {
  return { url, size, sha256 };
}

function action(sha, version) {
  return { sha, version };
}
