const { ethers } = require('ethers');
const contractResult = 'a21cea619a168f1ce3b64ce3d866a618d8283911044b02384f90607eec69dabc'; // the string inside contractResult[0], with 0x prefix
try {
  const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + contractResult.slice(8));
  console.log('Revert reason:', reason[0]);
} catch (e) {
  console.log('No decodable reason — contractResult:', contractResult);
}