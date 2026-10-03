const state={transactions:[]};
const titles={dashboard:"Business overview","cash-in":"Cash In","cash-out":"Cash Out",load:"Mobile Load",transactions:"Transactions"};

function showView(view){
  document.querySelectorAll(".view").forEach(el=>el.classList.remove("active"));
  document.querySelector("#"+view+"-view").classList.add("active");
  document.querySelectorAll(".nav-item").forEach(el=>el.classList.toggle("active",el.dataset.view===view));
  document.querySelector("#page-title").textContent=titles[view];
}
document.addEventListener("click",event=>{const target=event.target.closest("[data-view]");if(target)showView(target.dataset.view)});
function toast(message){const el=document.querySelector("#toast");el.textContent=message;el.classList.add("show");setTimeout(()=>el.classList.remove("show"),3500)}
function renderTransactions(){
  const body=document.querySelector("#transaction-list");
  if(!state.transactions.length){body.innerHTML='<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';return}
  body.innerHTML=state.transactions.map(t=>'<tr><td><strong>'+t.id+'</strong></td><td>'+t.type.replace("-"," ")+'</td><td>₱'+Number(t.amount).toLocaleString("en-PH",{minimumFractionDigits:2})+'</td><td>'+t.status+'</td><td>'+new Date(t.createdAt).toLocaleString("en-PH")+'</td></tr>').join("");
}
document.querySelectorAll(".transaction-form").forEach(form=>{
  form.addEventListener("submit",async event=>{
    event.preventDefault();
    const data=new FormData(form),payload=Object.fromEntries(data.entries());
    payload.type=form.dataset.type;payload.amount=Number(payload.amount);
    try{
      const response=await fetch("/api/transactions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"Request failed.");
      state.transactions.unshift(result.transaction);renderTransactions();toast(result.message);form.reset();
    }catch(error){toast(error.message)}
  });
});
renderTransactions();
