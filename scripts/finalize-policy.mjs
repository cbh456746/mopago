import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {DEFAULT_CATALOG} from '../src/game.js';
import {validateModel} from '../src/expert-agent.js';
import {DEFAULT_STAGE_WEIGHTS} from '../src/stage-distributions.js';

const root=new URL('../',import.meta.url);
const candidate=validateModel(JSON.parse(await fs.readFile(process.argv[2]??new URL('.local/expert-candidate.json',root),'utf8')),DEFAULT_CATALOG,DEFAULT_STAGE_WEIGHTS);
const evaluation=JSON.parse(await fs.readFile(new URL('.local/held-out-evaluation.json',root),'utf8'));
const fingerprint=createHash('sha256').update(JSON.stringify({signature:candidate.signature,weights:candidate.weights,featureNames:candidate.featureNames,gamma:candidate.gamma,search:candidate.search})).digest('hex');
const engineSha256=createHash('sha256').update((await fs.readFile(new URL('src/expert-agent.js',root),'utf8')).replaceAll('\r\n','\n')).digest('hex');
const tuning=candidate.training?.spatialTuning;
const accountedGames=candidate.training?.rounds*candidate.training?.population*candidate.training?.gamesPerCandidate+(tuning?.trainingGames??0);
if(candidate.training?.additionalGames<10000||candidate.training?.additionalGames!==candidate.episodes||
  accountedGames!==candidate.episodes||tuning&&tuning.candidates*tuning.gamesPerCandidate!==tuning.trainingGames)
  throw Error('At least 10,000 accounted training games are required');
if(evaluation.policySha256!==fingerprint||evaluation.engineSha256!==engineSha256||evaluation.truncated!==0||evaluation.episodes<1500)
  throw Error('Matching, uncapped held-out evaluation of at least 1500 games is required');
if(evaluation.targets.average!==100000||evaluation.targets.p90!==130000)throw Error('Unexpected targets');
const model=Object.fromEntries(['format','signature','featureNames','weights','episodes','objective','gamma','search'].map(k=>[k,candidate[k]]));
model.seed=candidate.training.seed;
model.training=structuredClone(candidate.training);delete model.training.validation;
model.metrics={evaluation};
delete model.metrics.evaluation.elapsedSeconds;
const format=n=>n.toLocaleString('en-US',{maximumFractionDigits:2}),passed=met=>met?'달성':'미달성';
const table=`<!-- evaluation-start -->
별도 평가 **${format(evaluation.episodes)}게임**의 결과입니다. 학습·후보 선택에 사용하지 않은 게임이며 모두 정상 종료했습니다.

| 지표 | 관측값 | 목표 / 판정 |
| --- | ---: | --- |
| 평균 점수 | ${format(evaluation.averageScore)} | 100,000 / **${passed(evaluation.targets.averageMet)}** |
| P90 점수 | ${format(evaluation.p90Score)} | 130,000 / **${passed(evaluation.targets.p90Met)}** |
| 관측 최고 점수 | ${format(evaluation.maxScore)} | 모의 평가에서 관측한 최고값 |
| 13만 점 이상 | ${format(evaluation.atLeast130000)}회 (${format(100*evaluation.atLeast130000/evaluation.episodes)}%) | 전체 시행 중 비율 |

추가 정책 탐색은 **${format(candidate.episodes)}게임**을 완료했습니다. 최종 수치와 재현 정보는 [평가 보고서](docs/EVALUATION.md)에 있습니다.
<!-- evaluation-end -->`;
for(const file of ['README.md','docs/LEARNING.md']){
  let document=await fs.readFile(new URL(file,root),'utf8');
  const block=file.startsWith('docs/')?table.replace('(docs/EVALUATION.md)','(EVALUATION.md)'):table;
  if(document.includes('<!-- evaluation-table -->'))document=document.replace('<!-- evaluation-table -->',block);
  else document=document.replace(/<!-- evaluation-start -->[\s\S]*?<!-- evaluation-end -->/,block);
  if(file==='README.md')document=document.replace('학습에는 후보당 24게임·후보 16개·30회 반복으로 **11,520게임의 추가 정책 탐색**을 계획했습니다.',
    `학습에는 후보당 ${candidate.training.gamesPerCandidate}게임·후보 ${candidate.training.population}개·${candidate.training.rounds}회 반복으로 **${format(candidate.episodes)}게임의 추가 정책 탐색**을 완료했습니다.`);
  if(file==='README.md'&&tuning)document=document.replace(/학습에는 후보당 .*?의 추가 정책 탐색\*\*을 완료했습니다\./,
    `초기 정책 탐색 ${format(candidate.training.rounds*candidate.training.population*candidate.training.gamesPerCandidate)}게임에 공간 특징 추가 탐색 ${format(tuning.trainingGames)}게임을 더해 **총 ${format(candidate.episodes)}게임**을 완료했습니다.`);
  await fs.writeFile(new URL(file,root),document);
}
const report=`# 배포 모델 별도 평가

최종 가중치를 고정한 뒤 학습·후보 선택에 사용하지 않은 세 시드에서 평가했습니다. 평가 결과를 보고 같은 평가 집합에서 다른 모델을 다시 선택하지 않았습니다. 정확한 공식 조각 확률이 아닌 **완만한 감소 가정**의 결과입니다.

${table.replace('(docs/EVALUATION.md)','(../README.md)').replace('최종 수치와 재현 정보는 [평가 보고서](../README.md)에 있습니다.','원시 게임별 점수와 보드 기록은 공개하지 않습니다.')}

## 시드별 집계

| 시작 시드 | 게임 | 평균 | P90 | 최고 | 13만 점 이상 | 제한 종료 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
${evaluation.runs.map(r=>'| '+[r.seed,r.episodes,format(r.averageScore),r.p90Score,r.maxScore,r.atLeast130000,r.truncated].join(' | ')+' |').join('\n')}

## 학습 조건

- 방법: 전체 게임의 보상으로 cross-entropy 정책 탐색.
- 초기 정책 탐색: ${candidate.training.rounds}회 × ${candidate.training.population}후보 × ${candidate.training.gamesPerCandidate}게임 = ${format(candidate.training.rounds*candidate.training.population*candidate.training.gamesPerCandidate)}게임.
${tuning?`- 공간 특징 추가 탐색: ${tuning.candidates}후보 × ${tuning.gamesPerCandidate}게임 = ${format(tuning.trainingGames)}게임. 합계 **${format(candidate.episodes)}게임**. 시작 시드 ${tuning.trainingSeed}.\n`:''}
- 탐색 난수 시드: ${candidate.training.seed}. 후보끼리 같은 회차의 시작 게임 시드를 공유합니다.
- 초기 내부 검증: 시드 ${candidate.training.validationSeed}, 매 검사 ${candidate.training.validationCount}게임. ${format(candidate.training.validationGames-(tuning?.validationGames??0))}회 게임 실행.
${tuning?`- 공간 특징 내부 검증: 시드 ${tuning.validationSeed}, 후보당 ${tuning.validationCount}게임, 합계 ${format(tuning.validationGames)}게임. 기존 후보와 탐색 상위 후보 두 개를 같은 환경에서 비교했습니다. 선택 후보 번호 ${tuning.selectedIndex}.\n`:''}
- 내부 검증의 총 ${format(candidate.training.validationGames)}게임은 학습 횟수·별도 평가에 합산하지 않습니다.
- 초기 선택 가중치: ${candidate.training.selectedRound}회차의 내부 검증에서 선택한 후보. ${tuning?'이후 공간 특징 추가 탐색을 거쳐 최종 가중치를 고정했습니다.':'이후 회차도 후보 탐색과 비교를 수행하며 개선이 없으면 이전 최고 후보를 유지합니다.'}
- 특징: 21개. 탐색 폭 ${candidate.search.beamWidth}, 최대 ${candidate.search.depth}행동. 모든 적법 첫 행동을 비교합니다.
- 분포: 단일 완만한 감소 가정, 5단계 1칸/10칸 상대 가중치 0.6. [전체 확률표](PROBABILITIES.md).

## 평가 조건

- 총 ${evaluation.episodes}게임, 각 시작 시드당 ${evaluation.gamesPerSeed}게임.
- 게임별 난수는 시작 시드와 게임 번호로 분리하며 병렬 순서에 영향을 받지 않습니다.
- 웹과 동일한 추천 함수·분포·탐색 설정을 사용합니다. 미래 추첨 정보는 추천기에 전달하지 않습니다.
- 일반 배치 7회마다 무작위 아이콘, 점 40%·교체 60%, 보유·보드 제한을 적용합니다.
- 게임당 최대 ${format(evaluation.maxSteps)}행동의 안전 제한. 제한 종료 ${evaluation.truncated}게임.
- P90: 정렬한 점수의 ceil(0.9 × N)번째 값. 상위 10% 평균이 아닙니다.

능력 아이콘은 점 ${format(evaluation.abilities.spawnedDot)}개·교체 ${format(evaluation.abilities.spawnedReroll)}개가 생성됐고, 능력 ${format(evaluation.abilities.acquired)}개를 획득했습니다. 점 찍기 ${format(evaluation.abilities.usedDot)}회, 바꿔 뽑기 ${format(evaluation.abilities.usedReroll)}회를 사용했습니다.

## 재현

~~~sh
npm run evaluate -- models/default.json ${evaluation.gamesPerSeed}
~~~

정상 종료 결과가 같아야 합니다. CPU 수는 처리 속도만 바꿉니다. 코드·분포·가중치가 바뀌면 새 평가가 필요합니다.

- 정책 SHA-256: ${fingerprint}
- 추천 엔진 SHA-256(LF 정규화): ${engineSha256}

관측 최고값은 이론상 최대나 실게임 성능 보장이 아닙니다. 목표를 달성했는지는 표의 평균·P90 판정을 각각 확인하세요.
`;
await fs.writeFile(new URL('docs/EVALUATION.md',root),report);
await fs.writeFile(new URL('models/default.json',root),JSON.stringify(model,null,2)+'\n');
console.log(JSON.stringify({trainingGames:model.episodes,average:evaluation.averageScore,p90:evaluation.p90Score,targets:evaluation.targets,policySha256:fingerprint}));
