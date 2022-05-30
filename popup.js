window.addEventListener('DOMContentLoaded', (event) => {

    let comparisonContainer = document.getElementById("comparisonContainer");
    let chart1 = document.getElementById("team1Canvas");
    let chart2 = document.getElementById("team2Canvas");
    let tableContainer = document.getElementById("tableContainer");
    let summaryButton = document.getElementById("summaryButton");
    let chartButton = document.getElementById("chartButton");

    let selectedIndex = -1;

    chrome.storage.sync.get(['currentMatchMapTable'], ({currentMatchMapTable}) => {
        if (!currentMatchMapTable)
        {
            comparisonContainer.innerHTML = "Go to a match page to see something here...";
            return;
        }

        function toggleTable(mapIndex)
        {
            if (mapIndex === selectedIndex) 
            {
                selectedIndex = -1;
                tableContainer.innerHTML = "";
            }
            else 
            {
                selectedIndex = mapIndex;
                tableContainer.innerHTML =
                `
                    <div class="tableHeader" style="background-image: url(${currentMatchMapTable[0].mapTable[selectedIndex].img})"><h3 class="tableTitle">${currentMatchMapTable[0].mapTable[selectedIndex].name}</h3></div>
                    <div>${currentMatchMapTable[0].mapTable[selectedIndex].avgPlayed}</div><div>PLAYRATE</div><div>${currentMatchMapTable[1].mapTable[selectedIndex].avgPlayed}</div>
                    <div>${currentMatchMapTable[0].mapTable[selectedIndex].avgRecentlyPlayed}</div><div>RECENTLY PLAYED</div><div>${currentMatchMapTable[1].mapTable[selectedIndex].avgRecentlyPlayed}</div>
                    <div>${Math.round(currentMatchMapTable[0].mapTable[selectedIndex].avgWinrate * 100)}%</div><div>WINRATE</div><div>${Math.round(currentMatchMapTable[1].mapTable[selectedIndex].avgWinrate * 100)}%</div>
                    <div>${currentMatchMapTable[0].mapTable[selectedIndex].avgKD}</div><div>KD RATIO</div><div>${currentMatchMapTable[1].mapTable[selectedIndex].avgKD}</div>
                `
            }    
        }

        chartButton.style.backgroundColor = "#282828";
        summaryButton.style.textDecoration = "underline";

        summaryButton.addEventListener('click', () => {
            document.getElementById("summaryPanel").style.display = "block";
            document.getElementById("chartPanel").style.display = "none";
            chartButton.style.backgroundColor = "#282828";
            chartButton.style.textDecoration = "none";
            summaryButton.style.backgroundColor = "#1A1A1D";
            summaryButton.style.textDecoration = "underline";
        })

        chartButton.addEventListener('click', () => {
            document.getElementById("summaryPanel").style.display = "none";
            document.getElementById("chartPanel").style.display = "block";
            chartButton.style.backgroundColor = "#1A1A1D";
            chartButton.style.textDecoration = "underline";
            summaryButton.style.backgroundColor = "#282828";
            summaryButton.style.textDecoration = "none";
        })

        let team1Names = document.getElementsByClassName("team1Name");
        for (let i = 0; i < team1Names.length; i++)
        {
            team1Names.item(i).innerHTML = currentMatchMapTable[0].name;
        }
        let team2Names = document.getElementsByClassName("team2Name");
        for (let i = 0; i < team2Names.length; i++)
        {
            team2Names.item(i).innerHTML = currentMatchMapTable[1].name;
        }
        createChart(chart1, currentMatchMapTable[0].mapTable, toggleTable);
        createChart(chart2, currentMatchMapTable[1].mapTable, toggleTable);

        createMapHighlights(currentMatchMapTable);
    })
});

function createChart(canvas, mapStats, toggleTable)
{
    const chartRadius = canvas.width * 0.35;
    const iconRadius = canvas.width * 0.425;

    let ctx = canvas.getContext("2d");
    let startAngle = 0;
    let mapPlayrateSum = 0;
    mapStats.forEach(map => {
        mapPlayrateSum += map.avgPlayed;
    });
    let chartAngles = [];

    mapStats.forEach(map => {
        chartAngles.push(startAngle);
        if (map.avgPlayed === 0) return;

        let mapAngle = 2 * Math.PI * map.avgPlayed / mapPlayrateSum;
        drawMapArc(ctx, map.img, canvas.width / 2, canvas.height / 2, chartRadius, map.avgWinrate * chartRadius, startAngle, startAngle + mapAngle);
        drawMapIcon(ctx, map.icon, canvas.width / 2, canvas.height / 2, iconRadius, startAngle + mapAngle / 2, 28);
        startAngle += mapAngle;
    });

    canvas.addEventListener('click', (event) => {
        let mouseX = event.offsetX;
        let mouseY = event.offsetY;
        let mouseR = Math.sqrt((mouseX - canvas.width / 2) * (mouseX - canvas.width / 2) + (mouseY - canvas.height / 2) * (mouseY - canvas.height / 2));
        let mouseAngle = Math.atan2((mouseY - canvas.height / 2), (mouseX - canvas.width / 2));
        if (mouseAngle < 0) mouseAngle = 2 * Math.PI + mouseAngle;
    
        if (mouseR > chartRadius) return;
    
        let mapIndex;
        for (mapIndex = 0; mapIndex < chartAngles.length - 1; mapIndex++)
        {
            if (chartAngles[mapIndex + 1] > mouseAngle) break;
        }

        toggleTable(mapIndex);
    })
}

function drawMapArc(ctx, img, x, y, r1, r2, startAngle, endAngle) 
{
    let mapImg = new Image();
    mapImg.src = img;
    mapImg.onload = () => {
        ctx.fillStyle = ctx.createPattern(mapImg, 'repeat');
        ctx.strokeStyle = "#000";
        ctx.beginPath();
        ctx.arc(x, y, r1, startAngle, endAngle);
        ctx.lineTo(x, y);
        ctx.lineTo(x + r1 * Math.cos(startAngle), y + r1 * Math.sin(startAngle));
        ctx.fill();
        ctx.stroke();

        /* winrate */
        ctx.fillStyle = "rgba(0, 255, 0, 0.2)";
        ctx.beginPath();
        ctx.arc(x, y, r2, startAngle, endAngle);
        ctx.lineTo(x, y);
        ctx.lineTo(x + r2 * Math.cos(startAngle), y + r2 * Math.sin(startAngle));
        ctx.fill();
    }
}

function drawMapIcon(ctx, icon, x, y, r, angle, size)
{
    let mapImg = new Image();
    mapImg.src = `chrome-extension://${chrome.runtime.id}/${icon}`;
    mapImg.onload = () => {
        ctx.drawImage(mapImg, x + r * Math.cos(angle) - size / 2, y + r * Math.sin(angle) - size / 2, size, size);
    }
}

function createMapHighlights(currentMatchMapTable)
{
    let mapRating = currentMatchMapTable[0].mapTable.map((map1, i) => {
        let map2 = currentMatchMapTable[1].mapTable[i];
        return {
            name: map1.name,
            icon: map1.icon,
            rating: (map1.avgWinrate * Math.log(1 + map1.avgPlayed) - map2.avgWinrate * Math.log(1 + map2.avgPlayed)) * Math.log(1 + map1.avgPlayed + map2.avgPlayed)
        };
    })
    mapRating.filter((map) => map.rating >= 1).sort((a, b) => b.rating - a.rating).forEach((map) => {
        document.getElementById("bestMapsT1").innerHTML += `<div class="mapContainer" style="flex-direction: row;"><img src=chrome-extension://${chrome.runtime.id}/${map.icon} width="30px" height="30px"><div height="30px" style="padding: 0px 5px;">${map.name}</div></div>`;
    })
    mapRating.filter((map) => map.rating <= -1).sort((a, b) => a.rating - b.rating).forEach((map) => {
        document.getElementById("bestMapsT2").innerHTML += `<div class="mapContainer" style="flex-direction: row-reverse;"><img src=chrome-extension://${chrome.runtime.id}/${map.icon} width="30px" height="30px"><div height="30px" style="padding: 0px 5px;">${map.name}</div></div>`;
    })

    currentMatchMapTable[0].mapTable.filter((map) => map.avgRecentlyPlayed > 0).sort((a, b) => b.avgRecentlyPlayed - a.avgRecentlyPlayed).forEach((map) => {
        document.getElementById("recentMapsT1").innerHTML += `<div class="mapContainer" style="flex-direction: row;"><img src=chrome-extension://${chrome.runtime.id}/${map.icon} width="30px" height="30px"><div height="30px" style="padding: 0px 5px;">${map.name}</div></div>`;
    })
    currentMatchMapTable[1].mapTable.filter((map) => map.avgRecentlyPlayed > 0).sort((a, b) => b.avgRecentlyPlayed - a.avgRecentlyPlayed).forEach((map) => {
        document.getElementById("recentMapsT2").innerHTML += `<div class="mapContainer" style="flex-direction: row-reverse;"><img src=chrome-extension://${chrome.runtime.id}/${map.icon} width="30px" height="30px"><div height="30px" style="padding: 0px 5px;">${map.name}</div></div>`;
    })
}